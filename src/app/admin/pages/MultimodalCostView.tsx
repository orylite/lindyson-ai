import {
  AlertTriangle,
  BrainCircuit,
  CircleDollarSign,
  Coins,
  Layers3,
  Users,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { isPaginationSnapshotChanged } from '../../api/client';
import * as queries from '../../api/queries';
import type { ExactCursorPagination, PagePosition } from '../../api/cursor';
import type {
  AdminMultimodalCostOperation,
  AdminMultimodalCostOperationFilters,
  AdminMultimodalCostOperationPage,
  AdminMultimodalCostOverview,
  AdminMultimodalCostOverviewFilters,
  AdminMultimodalCostUserPage,
} from '../../data/admin';
import { Badge,Button,Card,LoadingState } from '../../ui';
import { formatBeijingDateTime } from '../../utils/beijingTime';
import {
  AdminDataTable,
  MetricCard,
  SearchFilter,
  SelectFilter,
  Stack,
  number,
} from '../components/AdminPageShared';
import type { DetailState } from '../types';
import { registerMultimodalCostRefresh } from './multimodalCostRefresh';

type OperationTypeFilter = 'all' | AdminMultimodalCostOperation['operationType'];
type OperationStatusFilter = 'all' | AdminMultimodalCostOperation['status'];
type EstimateCompleteness = AdminMultimodalCostOverview['summary']['estimateCompleteness'];
type MultimodalUserPageState = Omit<AdminMultimodalCostUserPage, 'pagination'> & { pagination: ExactCursorPagination };
type MultimodalOperationPageState = Omit<AdminMultimodalCostOperationPage, 'pagination'> & { pagination: ExactCursorPagination };

interface ResourceState<T> {
  data: T | null;
  dataKey: string | null;
  loading: boolean;
  error: string | null;
  updatedAt: string | null;
}

const EMPTY_RESOURCE = {
  data: null,
  dataKey: null,
  loading: false,
  error: null,
  updatedAt: null,
};

export function AdminMultimodalCostView({
  filters,
  setDetail,
}: {
  filters: AdminMultimodalCostOverviewFilters;
  setDetail: (detail: DetailState) => void;
}) {
  const [operationType, setOperationType] = useState<OperationTypeFilter>('all');
  const [operationStatus, setOperationStatus] = useState<OperationStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [overviewState, setOverviewState] = useState<ResourceState<AdminMultimodalCostOverview>>(EMPTY_RESOURCE);
  const [usersState, setUsersState] = useState<ResourceState<MultimodalUserPageState>>(EMPTY_RESOURCE);
  const [operationsState, setOperationsState] = useState<ResourceState<MultimodalOperationPageState>>(EMPTY_RESOURCE);
  const overviewControllerRef = useRef<AbortController | null>(null);
  const usersControllerRef = useRef<AbortController | null>(null);
  const operationsControllerRef = useRef<AbortController | null>(null);
  const refreshSequenceRef = useRef(0);
  const snapshotNoticeShownRef = useRef(false);

  const baseFilters = useMemo<AdminMultimodalCostOverviewFilters>(() => ({
    range: filters.range,
    month: filters.month,
    date: filters.date,
    from: filters.from,
    to: filters.to,
  }), [filters.date, filters.from, filters.month, filters.range, filters.to]);
  const baseKey = useMemo(() => multimodalFilterKey(baseFilters), [baseFilters]);
  const operationFilters = useMemo<AdminMultimodalCostOperationFilters>(() => ({
    ...baseFilters,
    operationType: operationType === 'all' ? undefined : operationType,
    status: operationStatus === 'all' ? undefined : operationStatus,
    search: search.trim() || undefined,
  }), [baseFilters, operationStatus, operationType, search]);
  const operationKey = useMemo(() => multimodalFilterKey(operationFilters), [operationFilters]);
  const baseKeyRef = useRef(baseKey);
  const operationKeyRef = useRef(operationKey);
  baseKeyRef.current = baseKey;
  operationKeyRef.current = operationKey;

  const currentOverview = overviewState.dataKey === baseKey ? overviewState.data : null;
  const currentUsers = usersState.dataKey === baseKey ? usersState.data : null;
  const currentOperations = operationsState.dataKey === operationKey ? operationsState.data : null;

  const abortAll = useCallback(() => {
    refreshSequenceRef.current += 1;
    overviewControllerRef.current?.abort();
    usersControllerRef.current?.abort();
    operationsControllerRef.current?.abort();
    overviewControllerRef.current = null;
    usersControllerRef.current = null;
    operationsControllerRef.current = null;
  }, []);

  const fetchUsers = useCallback(async (
    snapshot: AdminMultimodalCostOverview,
    key: string,
    requestFilters: AdminMultimodalCostOverviewFilters,
    sequence: number,
    position: PagePosition = 'first',
    cursor?: string,
    snapshotCursor?: string,
  ) => {
    if (sequence !== refreshSequenceRef.current || baseKeyRef.current !== key) return;
    usersControllerRef.current?.abort();
    const controller = new AbortController();
    usersControllerRef.current = controller;
    setUsersState(previous => startResource(previous));
    try {
      const page = await queries.getAdminMultimodalCostUsersPage({
        ...requestFilters,
        asOf: snapshot.asOf,
        position,
        ...(cursor ? { cursor } : {}),
        ...(snapshotCursor ? { snapshotCursor } : {}),
        limit: 20,
      }, controller.signal);
      assertMultimodalPageConsistency(snapshot, page);
      if (usersControllerRef.current !== controller || sequence !== refreshSequenceRef.current || baseKeyRef.current !== key) return;
      setUsersState(resolveResource({ ...page, pagination: { ...page.pagination, position } }, key));
      if (position === 'first') snapshotNoticeShownRef.current = false;
    } catch (error) {
      if (isAbortError(error) || usersControllerRef.current !== controller || baseKeyRef.current !== key) return;
      setUsersState(previous => rejectResource(previous, error));
      throw error;
    } finally {
      if (usersControllerRef.current === controller) usersControllerRef.current = null;
    }
  }, []);

  const fetchOperations = useCallback(async (
    snapshot: AdminMultimodalCostOverview,
    key: string,
    requestFilters: AdminMultimodalCostOperationFilters,
    sequence: number,
    position: PagePosition = 'first',
    cursor?: string,
    snapshotCursor?: string,
  ) => {
    if (sequence !== refreshSequenceRef.current || operationKeyRef.current !== key) return;
    operationsControllerRef.current?.abort();
    const controller = new AbortController();
    operationsControllerRef.current = controller;
    setOperationsState(previous => startResource(previous));
    try {
      const page = await queries.getAdminMultimodalCostOperationsPage({
        ...requestFilters,
        asOf: snapshot.asOf,
        position,
        ...(cursor ? { cursor } : {}),
        ...(snapshotCursor ? { snapshotCursor } : {}),
        limit: 20,
      }, controller.signal);
      assertMultimodalPageConsistency(snapshot, page);
      if (operationsControllerRef.current !== controller || sequence !== refreshSequenceRef.current || operationKeyRef.current !== key) return;
      setOperationsState(resolveResource({ ...page, pagination: { ...page.pagination, position } }, key));
      if (position === 'first') snapshotNoticeShownRef.current = false;
    } catch (error) {
      if (isAbortError(error) || operationsControllerRef.current !== controller || operationKeyRef.current !== key) return;
      setOperationsState(previous => rejectResource(previous, error));
      throw error;
    } finally {
      if (operationsControllerRef.current === controller) operationsControllerRef.current = null;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const sequence = refreshSequenceRef.current + 1;
    abortAll();
    refreshSequenceRef.current = sequence;
    const requestedBaseKey = baseKey;
    const requestedOperationKey = operationKey;
    overviewControllerRef.current = new AbortController();
    const controller = overviewControllerRef.current;
    setOverviewState(previous => startResource(previous));
    setUsersState(previous => startResource(previous));
    setOperationsState(previous => startResource(previous));

    let snapshot: AdminMultimodalCostOverview;
    try {
      snapshot = await queries.getAdminMultimodalCostOverview(baseFilters, controller.signal);
      if (overviewControllerRef.current !== controller || sequence !== refreshSequenceRef.current || baseKeyRef.current !== requestedBaseKey) return;
      setOverviewState(resolveResource(snapshot, requestedBaseKey));
    } catch (error) {
      if (isAbortError(error) || overviewControllerRef.current !== controller || baseKeyRef.current !== requestedBaseKey) return;
      setOverviewState(previous => rejectResource(previous, error));
      setUsersState(previous => rejectResource(previous, error));
      setOperationsState(previous => rejectResource(previous, error));
      throw error;
    } finally {
      if (overviewControllerRef.current === controller) overviewControllerRef.current = null;
    }

    const detailResults = await Promise.allSettled([
      fetchUsers(snapshot, requestedBaseKey, baseFilters, sequence),
      fetchOperations(snapshot, requestedOperationKey, operationFilters, sequence),
    ]);
    const failure = detailResults.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }, [abortAll, baseFilters, baseKey, fetchOperations, fetchUsers, operationFilters, operationKey]);
  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshAllRef.current().catch(() => undefined);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      abortAll();
    };
  }, [abortAll, baseKey]);

  useEffect(() => registerMultimodalCostRefresh(refreshAll), [refreshAll]);

  const previousOperationKeyRef = useRef(operationKey);
  useEffect(() => {
    const keyChanged = previousOperationKeyRef.current !== operationKey;
    previousOperationKeyRef.current = operationKey;
    if (keyChanged) operationsControllerRef.current?.abort();
    if (!currentOverview || currentOperations || (!keyChanged && operationsControllerRef.current)) return;
    const timeout = window.setTimeout(() => {
      void fetchOperations(
        currentOverview,
        operationKey,
        operationFilters,
        refreshSequenceRef.current,
      ).catch(() => undefined);
    }, search ? 300 : 0);
    return () => window.clearTimeout(timeout);
  }, [currentOperations, currentOverview, fetchOperations, operationFilters, operationKey, search]);

  const navigateUsers = async (position: PagePosition) => {
    if (!currentOverview || !currentUsers) return;
    const cursor = pageCursor(currentUsers.pagination, position);
    if ((position === 'previous' || position === 'next') && !cursor) return;
    try {
      await fetchUsers(currentOverview, baseKey, baseFilters, refreshSequenceRef.current, position, cursor ?? undefined, currentUsers.pagination.snapshotCursor);
    } catch (error) {
      if (isPaginationSnapshotChanged(error)) {
        if (!snapshotNoticeShownRef.current) {
          snapshotNoticeShownRef.current = true;
          toast.info('列表已更新，已返回第 1 页');
        }
        await refreshAll();
        return;
      }
      toast.error(errorMessage(error, '用户成本翻页失败'));
    }
  };

  const navigateOperations = async (position: PagePosition) => {
    if (!currentOverview || !currentOperations) return;
    const cursor = pageCursor(currentOperations.pagination, position);
    if ((position === 'previous' || position === 'next') && !cursor) return;
    try {
      await fetchOperations(currentOverview, operationKey, operationFilters, refreshSequenceRef.current, position, cursor ?? undefined, currentOperations.pagination.snapshotCursor);
    } catch (error) {
      if (isPaginationSnapshotChanged(error)) {
        if (!snapshotNoticeShownRef.current) {
          snapshotNoticeShownRef.current = true;
          toast.info('列表已更新，已返回第 1 页');
        }
        await refreshAll();
        return;
      }
      toast.error(errorMessage(error, '操作成本翻页失败'));
    }
  };

  return (
    <>
      {!currentOverview ? (
        <ResourceBoundary
          state={overviewState}
          label="多模态成本汇总"
          onRetry={() => void refreshAll().catch(() => undefined)}
        />
      ) : (
        <div className="contents">
          {overviewState.error && (
            <StaleNotice state={overviewState} label="多模态成本汇总" onRetry={() => void refreshAll().catch(() => undefined)} />
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <MetricCard
              icon={WalletCards}
              label="当前可用人民币余额"
              value={cny(currentOverview.account.availableBalanceCny)}
              helper={`现金 ${cny(currentOverview.account.cashBalanceCny)} · 冻结 ${cny(currentOverview.account.frozenAmountCny)} · 同步 ${formatBeijingDateTime(currentOverview.account.syncedAt)}`}
              tone="purple"
            />
            <MetricCard
              icon={BrainCircuit}
              label="产品识别"
              value={`${number(currentOverview.summary.analysisCount)} 次`}
              helper={`${number(currentOverview.summary.userCount)} 位用户 · 平台调用 ${number(currentOverview.summary.operationalCallCount)} 次`}
              tone="blue"
            />
            <MetricCard
              icon={Layers3}
              label="方案批次"
              value={`${number(currentOverview.summary.batchCount)} 批`}
              helper={historicalCoverageLabel(
                currentOverview.summary.historicalPricedOperationCount,
                currentOverview.summary.historicalEvidenceOperationCount,
              )}
              tone="purple"
            />
            <MetricCard
              icon={Coins}
              label="最终实扣积分"
              value={`${number(currentOverview.summary.settledCredits)} 积分`}
              helper={`已退 ${number(currentOverview.summary.refundedCredits)} 积分`}
              tone="green"
            />
            <MetricCard
              icon={Users}
              label="已知 Token"
              value={tokenPair(currentOverview.summary.knownInputTokens, currentOverview.summary.knownOutputTokens)}
              helper={`缓存命中 ${tokenValue(currentOverview.summary.knownCachedInputTokens)}`}
              tone="blue"
            />
            <MetricCard
              icon={CircleDollarSign}
              label="官网列表价成本"
              value={knownCostValue(currentOverview.summary.knownAccountCostCny, currentOverview.summary.estimateCompleteness)}
              helper={`业务 ${cny(currentOverview.summary.businessEstimatedCostCny)} · 平台 ${cny(currentOverview.summary.operationalEstimatedCostCny)} · ${number(currentOverview.summary.unknownUsageRequestCount + currentOverview.summary.operationalUnpricedCallCount)} 次用量或价格待补`}
              tone="orange"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
            <span>报表周期：{currentOverview.selection.rangeStart} 至 {currentOverview.selection.rangeEnd}</span>
            <span>数据截点：{formatBeijingDateTime(currentOverview.asOf)}</span>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <SectionTitle title="模型成本汇总" description="当前仅统计提示词向导产生的 Doubao Seed 2.0 Lite 调用；不与视频官方账单混算。" />
        {currentOverview && <PricingSourceNotice models={currentOverview.models} />}
        {currentOverview ? (
          currentOverview.models.length > 0 ? (
            <AdminDataTable
              items={currentOverview.models}
              paginationLabel="多模态模型成本汇总分页导航"
              pageSize={6}
              gridTemplate="1.25fr .65fr .65fr .65fr .7fr .8fr 1fr 1.35fr 1fr"
              columns={[
                { header: '模型', render: row => <Stack title={modelLabel(row.model)} subtitle={row.provider} /> },
                { header: '产品识别', render: row => number(row.analysisCount) },
                { header: '方案批次', render: row => number(row.batchCount) },
                { header: '平台调用', render: row => number(row.operationalCallCount) },
                { header: '用户数', render: row => number(row.userCount) },
                { header: '实扣积分', render: row => <Stack title={number(row.settledCredits)} subtitle={row.refundedCredits > 0 ? `已退 ${number(row.refundedCredits)}` : undefined} /> },
                { header: '输入 / 输出', render: row => tokenPair(row.knownInputTokens, row.knownOutputTokens) },
                { header: '列表价成本', render: row => (
                  <Stack
                    title={knownCostValue(row.knownAccountCostCny, row.estimateCompleteness)}
                    subtitle={`业务 ${cny(row.businessEstimatedCostCny)} · 平台 ${cny(row.operationalEstimatedCostCny)}`}
                  />
                ) },
                { header: '完整性', render: row => completenessBadge(
                  row.estimateCompleteness,
                  row.unknownUsageRequestCount,
                  row.unpricedRequestCount + row.operationalUnpricedCallCount,
                  row.historicalEvidenceOperationCount,
                  row.historicalPricedOperationCount,
                ) },
              ]}
            />
          ) : <EmptyState label="所选周期暂无多模态模型成本" />
        ) : <ResourceBoundary state={overviewState} label="模型成本汇总" onRetry={() => void refreshAll().catch(() => undefined)} />}
      </section>

      <section className="space-y-3">
        <SectionTitle title="用户成本汇总" description="业务 run/batch 与平台测试调用分别计数；平台调用只归成本，不创建业务操作或积分。" />
        {currentUsers ? (
          <>
            {usersState.error && <StaleNotice state={usersState} label="用户成本汇总" onRetry={() => void fetchUsers(currentOverview!, baseKey, baseFilters, refreshSequenceRef.current).catch(() => undefined)} />}
            {currentUsers.items.length > 0 ? (
              <AdminDataTable
                items={currentUsers.items}
                paginationLabel="多模态用户成本汇总分页导航"
                pageSize={20}
                resetKey={`${currentUsers.asOf}:${baseKey}`}
                serverPagination={currentUsers.pagination}
                serverLoading={usersState.loading}
                onServerNavigate={position => void navigateUsers(position)}
                gridTemplate="1.25fr 1fr .65fr .65fr .65fr .75fr 1fr 1.3fr 1fr"
                columns={[
                  { header: '用户', render: row => <Stack title={row.name} subtitle={row.email} /> },
                  { header: '模型', render: row => row.models.map(modelLabel).join('、') },
                  { header: '产品识别', render: row => number(row.analysisCount) },
                  { header: '方案批次', render: row => number(row.batchCount) },
                  { header: '平台调用', render: row => number(row.operationalCallCount) },
                  { header: '实扣积分', render: row => number(row.settledCredits) },
                  { header: '输入 / 输出', render: row => tokenPair(row.knownInputTokens, row.knownOutputTokens) },
                  { header: '列表价成本', render: row => (
                    <Stack
                      title={knownCostValue(row.knownAccountCostCny, row.estimateCompleteness)}
                      subtitle={`业务 ${cny(row.businessEstimatedCostCny)} · 平台 ${cny(row.operationalEstimatedCostCny)}`}
                    />
                  ) },
                  { header: '最后活动', render: row => formatBeijingDateTime(row.lastActivityAt) },
                ]}
                onRowClick={row => setSearch(row.email)}
              />
            ) : <EmptyState label="所选周期暂无用户成本" />}
          </>
        ) : <ResourceBoundary state={usersState} label="用户成本汇总" onRetry={() => currentOverview && void fetchUsers(currentOverview, baseKey, baseFilters, refreshSequenceRef.current).catch(() => undefined)} />}
      </section>

      <Card className="p-4">
        <SearchFilter search={search} onSearch={setSearch} placeholder="搜索用户、邮箱、运行或批次 ID...">
          <SelectFilter<OperationTypeFilter> value={operationType} onChange={setOperationType} label="操作类型" options={[
            { value: 'all', label: '全部' },
            { value: 'analysis', label: '产品识别' },
            { value: 'plan-batch', label: '方案批次' },
          ]} />
          <SelectFilter<OperationStatusFilter> value={operationStatus} onChange={setOperationStatus} label="状态" options={[
            { value: 'all', label: '全部' },
            { value: 'analyzing', label: '识别中' },
            { value: 'ready', label: '待生成' },
            { value: 'queued', label: '排队中' },
            { value: 'processing', label: '生成中' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'archived', label: '已归档' },
          ]} />
        </SearchFilter>
        <p className="mt-3 text-xs text-gray-500">类型、状态和关键词只影响下方操作明细，不改变汇总与用户数据。</p>
      </Card>

      <section className="space-y-3">
        <SectionTitle title="分析与方案批次明细" description="产品识别 run 或方案 batch 各占一行；历史聚合 Token 按官方列表价单独定价，不伪装成逐请求账本。" />
        {currentOperations ? (
          <>
            {operationsState.error && <StaleNotice state={operationsState} label="操作成本明细" onRetry={() => void fetchOperations(currentOverview!, operationKey, operationFilters, refreshSequenceRef.current).catch(() => undefined)} />}
            {currentOperations.items.length > 0 ? (
              <AdminDataTable
                items={currentOperations.items}
                paginationLabel="多模态操作成本明细分页导航"
                pageSize={20}
                resetKey={`${currentOperations.asOf}:${operationKey}`}
                serverPagination={currentOperations.pagination}
                serverLoading={operationsState.loading}
                onServerNavigate={position => void navigateOperations(position)}
                gridTemplate="1fr 1.2fr .8fr .8fr 1fr .8fr 1fr .9fr"
                columns={[
                  { header: '发起时间', render: row => formatBeijingDateTime(row.createdAt) },
                  { header: '用户', render: row => <Stack title={row.userName} subtitle={row.email} /> },
                  { header: '类型', render: row => operationTypeLabel(row.operationType) },
                  { header: '状态', render: row => operationStatusBadge(row.status) },
                  { header: '模型', render: row => modelLabel(row.model) },
                  { header: '实扣积分', render: row => number(row.settledCredits) },
                  { header: '输入 / 输出', render: row => tokenPair(row.knownInputTokens, row.knownOutputTokens) },
                  { header: '列表价成本', render: row => operationCostValue(row) },
                ]}
                onRowClick={row => setDetail({
                  title: operationTypeLabel(row.operationType),
                  subtitle: row.batchId ?? row.runId,
                  content: <OperationDetail operation={row} />,
                  wide: true,
                })}
              />
            ) : <EmptyState label="当前筛选暂无分析或方案批次" />}
          </>
        ) : <ResourceBoundary state={operationsState} label="操作成本明细" onRetry={() => currentOverview && void fetchOperations(currentOverview, operationKey, operationFilters, refreshSequenceRef.current).catch(() => undefined)} />}
      </section>
    </>
  );
}

function OperationDetail({ operation }: { operation: AdminMultimodalCostOperation }) {
  const rows: Array<[string, ReactNode]> = [
    ['操作类型', operationTypeLabel(operation.operationType)],
    ['状态', operationStatusBadge(operation.status)],
    ['用户', `${operation.userName} · ${operation.email}`],
    ['模型', `${modelLabel(operation.model)} · ${operation.provider}`],
    ['运行 ID', operation.runId],
    ['批次 ID', operation.batchId ?? '不适用'],
    ['是否免费批次', operation.isFree === null ? '不适用' : operation.isFree ? '是' : '否'],
    ['最终实扣积分', `${number(operation.settledCredits)} 积分`],
    ['已退积分', `${number(operation.refundedCredits)} 积分`],
    ['输入 Token', tokenValue(operation.knownInputTokens)],
    ['缓存命中 Token', tokenValue(operation.knownCachedInputTokens)],
    ['输出 Token', tokenValue(operation.knownOutputTokens)],
    ['列表价成本', operationCostValue(operation)],
    ['证据来源', usageEvidenceBadge(operation.usageEvidence)],
    ...(operation.priceVersion ? [['价格版本', operation.priceVersion] as [string, ReactNode]] : []),
    ...(operation.pricingSourceUrl ? [[
      '官方价格来源',
      <a
        className="text-purple-300 underline decoration-purple-400/40 underline-offset-2 hover:text-purple-200"
        href={operation.pricingSourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        火山方舟模型价格
      </a>,
    ] as [string, ReactNode]] : []),
    ['供应商请求', `${number(operation.providerRequestCount)} 次`],
    ['已核对零用量请求', `${number(operation.reconciledZeroRequestCount)} 次`],
    ['未知用量请求', `${number(operation.unknownUsageRequestCount)} 次`],
    ['未定价请求', `${number(operation.unpricedRequestCount)} 次`],
    ['不完整请求', `${number(operation.incompleteRequestCount)} 次`],
    ['发起时间', formatBeijingDateTime(operation.createdAt)],
    ['完成时间', operation.completedAt ? formatBeijingDateTime(operation.completedAt) : '尚未完成'],
    ...(operation.failureReason ? [['失败原因', operation.failureReason] as [string, ReactNode]] : []),
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

function SectionTitle({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs text-gray-500">{description}</p></div>;
}

function PricingSourceNotice({ models }: { models: AdminMultimodalCostOverview['models'] }) {
  const sources = uniquePricingSources(models);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
      <span>列表价按官方公开价格估算，不等于火山账户实际扣款。</span>
      {sources.length > 0 ? sources.map(source => (
        <a
          key={`${source.priceVersion}:${source.sourceUrl}`}
          className="font-medium text-purple-300 underline decoration-purple-400/40 underline-offset-2 hover:text-purple-200"
          href={source.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          火山方舟模型价格（{source.priceVersion}）
        </a>
      )) : <span className="text-orange-300">官方价格来源暂不可用</span>}
    </div>
  );
}

function ResourceBoundary<T>({ state, label, onRetry }: { state: ResourceState<T>; label: string; onRetry: () => void }) {
  if (!state.error) return <LoadingState label={`正在加载${label}`} />;
  return (
    <Card className="border-orange-500/25 bg-orange-500/[0.06] p-5" role="alert">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-300" />
          <div>
            <p className="text-sm font-semibold text-white">{label}加载失败</p>
            <p className="mt-1 text-xs text-gray-400">{state.error}。未将缺失数据显示为 0。</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onRetry}>重新加载</Button>
      </div>
    </Card>
  );
}

function StaleNotice<T>({ state, label, onRetry }: { state: ResourceState<T>; label: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-orange-500/25 bg-orange-500/[0.06] px-4 py-3 text-xs sm:flex-row sm:items-center" role="status">
      <div>
        <p className="font-medium text-orange-100">{label}更新失败</p>
        <p className="mt-1 text-orange-100">仍显示上次数据{state.updatedAt ? `（上次成功加载 ${formatBeijingDateTime(state.updatedAt)}）` : ''}。{state.error ? ` ${state.error}` : ''}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry}>重试更新</Button>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-10 text-center text-sm text-gray-500" role="status">{label}</div>;
}

function startResource<T>(previous: ResourceState<T>): ResourceState<T> {
  return { ...previous, loading: true, error: null };
}

function resolveResource<T>(data: T, dataKey: string): ResourceState<T> {
  return { data, dataKey, loading: false, error: null, updatedAt: new Date().toISOString() };
}

function rejectResource<T>(previous: ResourceState<T>, error: unknown): ResourceState<T> {
  return { ...previous, loading: false, error: errorMessage(error, '请求失败，请稍后重试') };
}

function multimodalFilterKey(filters: object) {
  return new URLSearchParams(Object.entries(filters).flatMap(([key, value]) => (
    typeof value === 'string' && value.length > 0 ? [[key, value]] : []
  ))).toString();
}

function pageCursor(pagination: ExactCursorPagination, position: PagePosition) {
  if (position === 'previous') return pagination.previousCursor;
  if (position === 'next') return pagination.nextCursor;
  return null;
}

function assertMultimodalPageConsistency(
  overview: AdminMultimodalCostOverview,
  page: Pick<AdminMultimodalCostUserPage, 'asOf' | 'selection'>,
) {
  if (
    page.asOf !== overview.asOf
    || page.selection.rangeStart !== overview.selection.rangeStart
    || page.selection.rangeEnd !== overview.selection.rangeEnd
  ) {
    throw new Error('多模态成本明细未返回统一数据截点，请刷新后重试');
  }
}

export function knownCostValue(value: string | null, completeness: EstimateCompleteness) {
  if (value === null || completeness === 'unavailable') return '成本证据不足 / 待核对';
  return completeness === 'partial' ? `${cny(value)}+` : cny(value);
}

function operationCostValue(operation: Pick<AdminMultimodalCostOperation, 'knownCostCny' | 'estimateCompleteness' | 'usageEvidence'>) {
  if (operation.usageEvidence === 'historical' && (operation.knownCostCny === null || operation.estimateCompleteness === 'unavailable')) {
    return '历史证据不足 / 待核对';
  }
  return knownCostValue(operation.knownCostCny, operation.estimateCompleteness);
}

function cny(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '数据不可用';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `¥${parsed.toFixed(6)}` : '数据不可用';
}

function tokenValue(value: number | null) {
  return value === null ? '待核对' : number(value);
}

function tokenPair(input: number | null, output: number | null) {
  return `${tokenValue(input)} / ${tokenValue(output)}`;
}

function modelLabel(model: string) {
  return model === 'doubao-seed-2-0-lite-260428' ? 'Doubao Seed 2.0 Lite' : model;
}

function operationTypeLabel(type: AdminMultimodalCostOperation['operationType']) {
  return type === 'analysis' ? '产品识别' : '方案批次';
}

function operationStatusBadge(status: AdminMultimodalCostOperation['status']) {
  const labels: Record<AdminMultimodalCostOperation['status'], string> = {
    analyzing: '识别中',
    ready: '待生成',
    queued: '排队中',
    processing: '生成中',
    completed: '已完成',
    failed: '失败',
    archived: '已归档',
  };
  const variant = status === 'completed'
    ? 'success'
    : status === 'failed'
      ? 'error'
      : status === 'archived'
        ? 'default'
        : 'purple';
  return <Badge variant={variant} dot={status === 'analyzing' || status === 'queued' || status === 'processing'}>{labels[status]}</Badge>;
}

function usageEvidenceBadge(evidence: AdminMultimodalCostOperation['usageEvidence']) {
  const label = usageEvidenceLabel(evidence);
  if (evidence === 'ledger' || evidence === 'ledger-reconciled') return <Badge variant="success">{label}</Badge>;
  if (evidence === 'historical-aggregate-priced') return <Badge variant="purple">{label}</Badge>;
  if (evidence === 'historical') return <Badge variant="warning">{label}</Badge>;
  return <Badge variant="error">{label}</Badge>;
}

export function usageEvidenceLabel(evidence: AdminMultimodalCostOperation['usageEvidence']) {
  if (evidence === 'ledger') return '逐请求账本';
  if (evidence === 'ledger-reconciled') return '逐请求账本 + 官方核对';
  if (evidence === 'historical-aggregate-priced') return '历史聚合 Token 定价';
  if (evidence === 'historical') return '历史聚合';
  return '证据不可用';
}

function completenessBadge(
  completeness: EstimateCompleteness,
  unknown: number,
  unpriced: number,
  historical: number,
  historicalPriced = 0,
) {
  const label = completenessLabel(completeness, unknown, unpriced, historical, historicalPriced);
  if (completeness === 'complete') return <Badge variant="success">{label}</Badge>;
  if (completeness === 'partial') return <Badge variant="warning">{label}</Badge>;
  return <Badge variant="error">{label}</Badge>;
}

export function completenessLabel(
  completeness: EstimateCompleteness,
  unknown: number,
  unpriced: number,
  historical: number,
  historicalPriced = 0,
) {
  const pricedLabel = historicalPriced > 0
    ? `${number(historicalPriced)} 项历史聚合 Token 已定价`
    : null;
  if (completeness === 'complete') return pricedLabel ? `完整 · ${pricedLabel}` : '完整';
  const reasons = [
    unknown > 0 ? `${number(unknown)} 次用量未知` : null,
    unpriced > 0 ? `${number(unpriced)} 次未定价` : null,
    historical > 0 ? `${number(historical)} 项历史证据不足` : null,
    pricedLabel,
  ].filter((reason): reason is string => reason !== null);
  const status = completeness === 'partial' ? '部分' : '不可用';
  return reasons.length > 0 ? `${status} · ${reasons.join(' · ')}` : `${status} · 完整性原因待核对`;
}

export function historicalCoverageLabel(
  historicalPriced: number | null | undefined,
  historicalEvidence: number | null | undefined,
) {
  return `${number(historicalPriced ?? 0)} 项历史聚合 Token 已定价、${number(historicalEvidence ?? 0)} 项历史证据不足`;
}

export function uniquePricingSources(models: AdminMultimodalCostOverview['models']) {
  return Array.from(new Map(models.flatMap(model => model.pricingSources).map(source => [
    `${source.priceVersion}:${source.sourceUrl}`,
    source,
  ])).values());
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
