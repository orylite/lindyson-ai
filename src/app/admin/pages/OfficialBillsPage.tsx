import {
  ArrowLeft,
  CircleDollarSign,
  FileCheck2,
  FileClock,
  Layers3,
  ReceiptText,
  WalletCards,
} from 'lucide-react';
import { useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from 'react';
import { toast } from 'sonner';
import { isPaginationSnapshotChanged } from '../../api/client';
import * as queries from '../../api/queries';
import type { ExactCursorPagination,PagePosition } from '../../api/cursor';
import type {
  AdminProviderBillingDetail,
  AdminProviderBillingDetailsFilters,
  AdminProviderBillingDetailsPage,
  AdminProviderBillingFilters,
  AdminProviderBillingOperationalUsage,
  AdminProviderBillingOperationalUsageFilters,
  AdminProviderBillingOperationalUsagePage,
  AdminProviderBillingOverview,
} from '../../data/admin';
import { Badge,Button,Card,DatePicker,Input,LoadingState } from '../../ui';
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
} from '../components/AdminPageShared';
import { registerOfficialBillsRefresh } from './officialBillsRefresh';

type BillingRange = 'all' | 'month' | 'custom';
type ServiceType = 'video' | 'image' | 'multimodal' | 'storage' | 'other';
type ServiceTypeFilter = 'all' | ServiceType;
type FinalityFilter = 'all' | 'final' | 'provisional';
type AttributionFilter = 'all' | 'business' | 'admin-operational' | 'account-level' | 'unattributed';
type BillingDetailPageState = Omit<AdminProviderBillingDetailsPage, 'pagination'> & { pagination: ExactCursorPagination };
type OperationalUsagePageState = Omit<AdminProviderBillingOperationalUsagePage, 'pagination'> & { pagination: ExactCursorPagination };

interface ResourceState<T> {
  data: T | null;
  dataKey: string | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_RESOURCE: ResourceState<never> = {
  data: null,
  dataKey: null,
  loading: false,
  error: null,
};

export interface OfficialBillsSelection {
  range: BillingRange;
  month: string;
  from: string;
  to: string;
  product: string;
  serviceType: ServiceTypeFilter;
  model: string;
  finality: FinalityFilter;
  attributionStatus: AttributionFilter;
  search: string;
}

export function AdminOfficialBillsPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [initialSelection] = useState(readOfficialBillsSelection);
  const [range, setRange] = useState(initialSelection.range);
  const [month, setMonth] = useState(initialSelection.month);
  const [from, setFrom] = useState(initialSelection.from);
  const [to, setTo] = useState(initialSelection.to);
  const [product, setProduct] = useState(initialSelection.product);
  const [serviceType, setServiceType] = useState<ServiceTypeFilter>(initialSelection.serviceType);
  const [model, setModel] = useState(initialSelection.model);
  const [finality, setFinality] = useState<FinalityFilter>(initialSelection.finality);
  const [attributionStatus, setAttributionStatus] = useState<AttributionFilter>(initialSelection.attributionStatus);
  const [search, setSearch] = useState(initialSelection.search);
  const [overviewState, setOverviewState] = useState<ResourceState<AdminProviderBillingOverview>>(EMPTY_RESOURCE);
  const [detailsState, setDetailsState] = useState<ResourceState<BillingDetailPageState>>(EMPTY_RESOURCE);
  const [operationsState, setOperationsState] = useState<ResourceState<OperationalUsagePageState>>(EMPTY_RESOURCE);
  const overviewControllerRef = useRef<AbortController | null>(null);
  const detailsControllerRef = useRef<AbortController | null>(null);
  const operationsControllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const snapshotNoticeShownRef = useRef(false);
  const today = beijingToday();
  const currentMonth = today.slice(0, 7);

  const selection = useMemo<OfficialBillsSelection>(() => ({
    range,
    month,
    from,
    to,
    product,
    serviceType,
    model,
    finality,
    attributionStatus,
    search,
  }), [attributionStatus, finality, from, model, month, product, range, search, serviceType, to]);
  const filters = useMemo<AdminProviderBillingFilters>(() => officialBillsFilters(selection), [selection]);
  const filterKey = useMemo(() => buildOfficialBillsQuery(selection), [selection]);
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;

  const currentOverview = overviewState.dataKey === filterKey ? overviewState.data : null;
  const currentDetails = detailsState.dataKey === filterKey ? detailsState.data : null;
  const currentOperations = operationsState.dataKey === filterKey ? operationsState.data : null;

  const abortAll = useCallback(() => {
    sequenceRef.current += 1;
    overviewControllerRef.current?.abort();
    detailsControllerRef.current?.abort();
    operationsControllerRef.current?.abort();
    overviewControllerRef.current = null;
    detailsControllerRef.current = null;
    operationsControllerRef.current = null;
  }, []);

  const loadDetails = useCallback(async (
    overview: AdminProviderBillingOverview,
    requestedFilters: AdminProviderBillingFilters,
    requestedKey: string,
    sequence: number,
    position: PagePosition = 'first',
    cursor?: string,
    snapshotCursor?: string,
  ) => {
    if (filterKeyRef.current !== requestedKey || sequenceRef.current !== sequence) return;
    detailsControllerRef.current?.abort();
    const controller = new AbortController();
    detailsControllerRef.current = controller;
    setDetailsState(previous => startResource(previous));
    try {
      const page = await queries.getAdminProviderBillingDetailsPage({
        ...requestedFilters,
        asOf: overview.asOf,
        position,
        ...(cursor ? { cursor } : {}),
        ...(snapshotCursor ? { snapshotCursor } : {}),
        limit: 20,
      } as AdminProviderBillingDetailsFilters & { position: PagePosition; cursor?: string; snapshotCursor?: string; limit: number }, controller.signal);
      assertBillingPageConsistency(overview, page);
      if (detailsControllerRef.current !== controller || sequenceRef.current !== sequence || filterKeyRef.current !== requestedKey) return;
      setDetailsState(resolveResource(withPosition(page, position), requestedKey));
      if (position === 'first') snapshotNoticeShownRef.current = false;
    } catch (error) {
      if (isAbortError(error) || detailsControllerRef.current !== controller || filterKeyRef.current !== requestedKey) return;
      setDetailsState(previous => rejectResource(previous, error));
      throw error;
    } finally {
      if (detailsControllerRef.current === controller) detailsControllerRef.current = null;
    }
  }, []);

  const loadOperations = useCallback(async (
    overview: AdminProviderBillingOverview,
    requestedFilters: AdminProviderBillingFilters,
    requestedKey: string,
    sequence: number,
    position: PagePosition = 'first',
    cursor?: string,
    snapshotCursor?: string,
  ) => {
    if (filterKeyRef.current !== requestedKey || sequenceRef.current !== sequence) return;
    operationsControllerRef.current?.abort();
    const controller = new AbortController();
    operationsControllerRef.current = controller;
    setOperationsState(previous => startResource(previous));
    try {
      const page = await queries.getAdminProviderBillingOperationalUsagePage({
        ...requestedFilters,
        asOf: overview.asOf,
        position,
        ...(cursor ? { cursor } : {}),
        ...(snapshotCursor ? { snapshotCursor } : {}),
        limit: 20,
      } as AdminProviderBillingOperationalUsageFilters & { position: PagePosition; cursor?: string; snapshotCursor?: string; limit: number }, controller.signal);
      assertBillingPageConsistency(overview, page);
      if (operationsControllerRef.current !== controller || sequenceRef.current !== sequence || filterKeyRef.current !== requestedKey) return;
      setOperationsState(resolveResource(withPosition(page, position), requestedKey));
      if (position === 'first') snapshotNoticeShownRef.current = false;
    } catch (error) {
      if (isAbortError(error) || operationsControllerRef.current !== controller || filterKeyRef.current !== requestedKey) return;
      setOperationsState(previous => rejectResource(previous, error));
      throw error;
    } finally {
      if (operationsControllerRef.current === controller) operationsControllerRef.current = null;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    abortAll();
    const sequence = sequenceRef.current;
    const requestedKey = filterKey;
    const requestedFilters = filters;
    const controller = new AbortController();
    overviewControllerRef.current = controller;
    setOverviewState(previous => startResource(previous));
    setDetailsState(previous => startResource(previous));
    setOperationsState(previous => startResource(previous));

    let overview: AdminProviderBillingOverview;
    try {
      overview = await queries.getAdminProviderBillingOverview(requestedFilters, controller.signal);
      if (overviewControllerRef.current !== controller || sequenceRef.current !== sequence || filterKeyRef.current !== requestedKey) return;
      setOverviewState(resolveResource(overview, requestedKey));
    } catch (error) {
      if (isAbortError(error) || overviewControllerRef.current !== controller || filterKeyRef.current !== requestedKey) return;
      setOverviewState(previous => rejectResource(previous, error));
      setDetailsState(previous => rejectResource(previous, error));
      setOperationsState(previous => rejectResource(previous, error));
      throw error;
    } finally {
      if (overviewControllerRef.current === controller) overviewControllerRef.current = null;
    }

    const results = await Promise.allSettled([
      loadDetails(overview, requestedFilters, requestedKey, sequence),
      loadOperations(overview, requestedFilters, requestedKey, sequence),
    ]);
    const firstFailure = results.find(result => result.status === 'rejected');
    if (firstFailure?.status === 'rejected') throw firstFailure.reason;
  }, [abortAll, filterKey, filters, loadDetails, loadOperations]);
  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;

  useEffect(() => registerOfficialBillsRefresh(refreshAll), [refreshAll]);

  useEffect(() => {
    writeOfficialBillsSelection(selection);
  }, [selection]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshAllRef.current().catch(() => undefined);
    }, search.trim() || model.trim() ? 300 : 0);
    return () => {
      window.clearTimeout(timeout);
      abortAll();
    };
  }, [abortAll, filterKey, search]);

  const navigateDetails = async (position: PagePosition) => {
    if (!currentOverview || !currentDetails) return;
    const cursor = pageCursor(currentDetails.pagination, position);
    if ((position === 'previous' || position === 'next') && !cursor) return;
    try {
      await loadDetails(currentOverview, filters, filterKey, sequenceRef.current, position, cursor ?? undefined, currentDetails.pagination.snapshotCursor);
    } catch (error) {
      if (isPaginationSnapshotChanged(error)) {
        if (!snapshotNoticeShownRef.current) {
          snapshotNoticeShownRef.current = true;
          toast.info('列表已更新，已返回第 1 页');
        }
        await refreshAll();
        return;
      }
      toast.error(errorMessage(error, '官方账单翻页失败'));
    }
  };

  const navigateOperations = async (position: PagePosition) => {
    if (!currentOverview || !currentOperations) return;
    const cursor = pageCursor(currentOperations.pagination, position);
    if ((position === 'previous' || position === 'next') && !cursor) return;
    try {
      await loadOperations(currentOverview, filters, filterKey, sequenceRef.current, position, cursor ?? undefined, currentOperations.pagination.snapshotCursor);
    } catch (error) {
      if (isPaginationSnapshotChanged(error)) {
        if (!snapshotNoticeShownRef.current) {
          snapshotNoticeShownRef.current = true;
          toast.info('列表已更新，已返回第 1 页');
        }
        await refreshAll();
        return;
      }
      toast.error(errorMessage(error, '运营调用翻页失败'));
    }
  };

  const productOptions = useMemo(() => {
    const values = new Map<string, string>();
    if (product) values.set(product, product);
    currentOverview?.products.forEach(item => values.set(
      item.product,
      item.productName ? `${item.productName} · ${item.product}` : item.product,
    ));
    return [
      { value: 'all', label: '全部产品' },
      ...Array.from(values, ([value, label]) => ({ value, label })),
    ];
  }, [currentOverview?.products, product]);

  const selectedProduct = product || 'all';
  const resetFilters = () => {
    setProduct('');
    setServiceType('all');
    setModel('');
    setFinality('all');
    setAttributionStatus('all');
    setSearch('');
  };

  return (
    <PageShell
      width="cost"
      eyebrow="OFFICIAL BILLING"
      title="官方账单"
      subtitle="直接查看供应商费用中心的官方金额、产品归类和账单归属；列表价估算与官方实际应付保持分账展示。"
      action={(
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => onNavigate(`/admin/api-usage${billingBackQuery(selection)}`)}
        >
          返回成本看盘
        </Button>
      )}
    >
      <Card className="p-4">
        <div className="flex flex-col justify-between gap-4 2xl:flex-row 2xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-white">账单筛选</h2>
              {(overviewState.loading || detailsState.loading || operationsState.loading) && <Badge variant="purple" dot>正在更新</Badge>}
            </div>
            <p className="mt-2 max-w-xl text-xs leading-5 text-gray-500">周期按官方费用日期归属，全部日期按北京时间展示；终账与暂估不会合并成同一种状态。</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <FilterChips<BillingRange>
              value={range}
              onChange={setRange}
              label="周期"
              options={[
                { value: 'all', label: '全部' },
                { value: 'month', label: '月份' },
                { value: 'custom', label: '自选周期' },
              ]}
            />
            {range === 'month' ? (
              <DatePicker mode="month" size="filter" label="月份" value={month} max={currentMonth} onValueChange={value => setMonth(validMonth(value, currentMonth) ? value : currentMonth)} />
            ) : range === 'custom' ? (
              <>
                <DatePicker mode="date" size="filter" label="开始日期" value={from} max={to} onValueChange={value => setFrom(validDate(value, to) ? value : to)} />
                <DatePicker mode="date" size="filter" label="结束日期" value={to} max={today} onValueChange={value => setTo(validDate(value, today) && value >= from ? value : from)} />
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SelectFilter
            value={selectedProduct}
            onChange={value => setProduct(value === 'all' ? '' : value)}
            label="产品"
            options={productOptions}
          />
          <SelectFilter<ServiceTypeFilter> value={serviceType} onChange={setServiceType} label="服务" options={SERVICE_OPTIONS} />
          <Input label="模型" value={model} onChange={event => setModel(event.target.value)} placeholder="输入精确模型名称" className="h-10 min-w-0" />
          <SelectFilter<FinalityFilter> value={finality} onChange={setFinality} label="终账" options={FINALITY_OPTIONS} />
          <SelectFilter<AttributionFilter> value={attributionStatus} onChange={setAttributionStatus} label="归属" options={ATTRIBUTION_OPTIONS} />
        </div>

        <div className="mt-4">
          <SearchFilter search={search} onSearch={setSearch} placeholder="搜索产品、模型、账单明细或运营调用...">
            <Button variant="ghost" size="sm" onClick={resetFilters}>清除业务筛选</Button>
          </SearchFilter>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
          <span>当前范围：{currentOverview ? `${currentOverview.selection.rangeStart} 至 ${currentOverview.selection.rangeEnd}` : selectedRange(selection, today)}</span>
          <span>数据截点：{currentOverview ? formatBeijingDateTime(currentOverview.asOf) : '等待当前筛选数据'}</span>
        </div>
        <p className="mt-3 text-xs leading-5 text-amber-200/80">
          账户级费用不按模型或业务任务伪分摊；待归属表示当前证据不足，不能计入业务调用或运营调用。
        </p>
      </Card>

      {!currentOverview ? (
        <ResourceBoundary state={overviewState} label="官方账单汇总" onRetry={() => void refreshAll().catch(() => undefined)} />
      ) : (
        <>
          {overviewState.error && <StaleNotice label="官方账单汇总" error={overviewState.error} onRetry={() => void refreshAll().catch(() => undefined)} />}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={ReceiptText} label="官方原价金额" value={cny(currentOverview.summary.originalBillAmountCny)} helper={`${number(currentOverview.summary.lineCount)} 条账单 · ${number(currentOverview.summary.productCount)} 个产品`} tone="blue" />
            <MetricCard icon={Layers3} label="官方优惠后金额" value={cny(currentOverview.summary.preferentialBillAmountCny)} helper="费用中心优惠后账单金额合计" tone="green" />
            <MetricCard icon={CircleDollarSign} label="官方折扣金额" value={cny(currentOverview.summary.discountBillAmountCny)} helper="折扣金额保留官方正负号" tone="orange" />
            <MetricCard icon={FileCheck2} label="官方优惠券金额" value={cny(currentOverview.summary.couponAmountCny)} helper="优惠券抵扣按官方账单汇总" tone="green" />
            <MetricCard icon={CircleDollarSign} label="官方应付金额" value={cny(currentOverview.summary.payableAmountCny)} helper="最终应付与原价、优惠分别列示" tone="orange" />
            <MetricCard icon={WalletCards} label="官方已付金额" value={cny(currentOverview.summary.paidAmountCny)} helper="按费用中心当前账单版本汇总" tone="green" />
            <MetricCard icon={FileClock} label="官方未付金额" value={cny(currentOverview.summary.unpaidAmountCny)} helper="负向调整和退款保留原始符号" tone="blue" />
            <MetricCard icon={FileCheck2} label="终账覆盖" value={`${number(currentOverview.summary.finalLineCount)} / ${number(currentOverview.summary.lineCount)}`} helper={`${number(currentOverview.summary.provisionalLineCount)} 条仍为暂估`} tone={currentOverview.summary.provisionalLineCount > 0 ? 'orange' : 'green'} />
          </div>

          <section className="space-y-3">
            <SectionTitle title="产品分组" description="按官方产品与服务类型聚合金额；不把账户级账单伪分摊到业务模型。" />
            <AdminDataTable
              items={currentOverview.products.map(item => ({ ...item, id: `${item.product}:${item.serviceType}` }))}
              paginationLabel="官方账单产品分组分页导航"
              pageSize={10}
              minTableWidth={1740}
              gridTemplate="minmax(260px,1.5fr) minmax(130px,.7fr) minmax(130px,.7fr) repeat(7,minmax(140px,.8fr))"
              columns={[
                { header: '官方产品', render: item => <Stack title={item.productName ?? item.product} subtitle={item.productName ? item.product : '未提供产品名称'} /> },
                { header: '服务类型', render: item => serviceTypeBadge(item.serviceType) },
                { header: '账单行', render: item => <Stack title={number(item.lineCount)} subtitle={`终账 ${number(item.finalLineCount)} · 暂估 ${number(item.provisionalLineCount)}`} /> },
                { header: '原价', render: item => cny(item.originalBillAmountCny) },
                { header: '优惠后', render: item => cny(item.preferentialBillAmountCny) },
                { header: '折扣', render: item => cny(item.discountBillAmountCny) },
                { header: '优惠券', render: item => cny(item.couponAmountCny) },
                { header: '应付', render: item => cny(item.payableAmountCny) },
                { header: '已付', render: item => cny(item.paidAmountCny) },
                { header: '未付', render: item => cny(item.unpaidAmountCny) },
              ]}
              emptyLabel="当前筛选范围没有官方产品账单"
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownCard
              title="服务类型结构"
              icon={<Layers3 className="h-4 w-4" />}
              rows={currentOverview.byServiceType.map(item => ({
                id: item.serviceType,
                title: serviceTypeLabel(item.serviceType),
                count: item.lineCount,
                originalAmount: item.originalBillAmountCny,
                preferentialAmount: item.preferentialBillAmountCny,
                discountAmount: item.discountBillAmountCny,
                couponAmount: item.couponAmountCny,
                payableAmount: item.payableAmountCny,
              }))}
            />
            <BreakdownCard
              title="账单归属结构"
              icon={<ReceiptText className="h-4 w-4" />}
              rows={currentOverview.byAttribution.map(item => ({
                id: item.attributionStatus,
                title: attributionLabel(item.attributionStatus),
                count: item.lineCount,
                originalAmount: item.originalBillAmountCny,
                preferentialAmount: item.preferentialBillAmountCny,
                discountAmount: item.discountBillAmountCny,
                couponAmount: item.couponAmountCny,
                payableAmount: item.payableAmountCny,
              }))}
            />
          </div>
        </>
      )}

      <section className="space-y-3">
        <SectionTitle title="逐行官方账单" description="逐行保留官方费用日期、产品、用量、金额、终账状态与归属；金额允许负向调整。" />
        {currentDetails ? (
          <>
            {detailsState.error && <StaleNotice label="逐行官方账单" error={detailsState.error} onRetry={() => currentOverview && void loadDetails(currentOverview, filters, filterKey, sequenceRef.current).catch(() => undefined)} />}
            <AdminDataTable
              items={currentDetails.items}
              paginationLabel="逐行官方账单分页导航"
              paginate={false}
              pageSize={20}
              minTableWidth={1440}
              resetKey={`${filterKey}:${currentOverview?.asOf ?? 'pending'}`}
              serverPagination={currentDetails.pagination}
              serverLoading={detailsState.loading}
              onServerNavigate={position => void navigateDetails(position)}
              gridTemplate="minmax(120px,.6fr) minmax(260px,1.4fr) minmax(180px,1fr) minmax(170px,.9fr) minmax(150px,.8fr) minmax(170px,.9fr) minmax(160px,.8fr)"
              columns={[
                { header: '费用日期', render: item => <Stack title={item.expenseDate} subtitle={item.billPeriod} /> },
                { header: '产品 / 明细', render: item => <Stack title={item.productName ?? item.product} subtitle={`${billLineTypeLabel(item.billLineType)} · ${item.sourceDetailKey}`} /> },
                { header: '服务 / 模型', render: item => <Stack title={serviceTypeLabel(item.serviceType)} subtitle={item.model ?? '账户级，未识别模型'} /> },
                { header: '终账 / 归属', render: item => <Stack title={finalityBadge(item.finality)} subtitle={attributionLabel(item.attributionStatus)} /> },
                { header: '官方用量', render: item => usageLabel(item) },
                { header: '应付 / 已付', render: item => <Stack title={cny(item.payableAmountCny)} subtitle={`已付 ${cny(item.paidAmountCny)}`} /> },
                { header: '未付 / 同步', render: item => <Stack title={cny(item.unpaidAmountCny)} subtitle={formatBeijingDateTime(item.syncedAt)} /> },
              ]}
              emptyLabel="当前筛选范围没有官方账单明细"
            />
          </>
        ) : (
          <ResourceBoundary state={detailsState} label="逐行官方账单" onRetry={() => currentOverview && void loadDetails(currentOverview, filters, filterKey, sequenceRef.current).catch(() => undefined)} />
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle title="运营调用" description="只展示已明确标记的后台运营调用及其本地估值、官方账单链接与对账状态；不伪造前端业务任务。" />
        {currentOperations ? (
          <>
            {operationsState.error && <StaleNotice label="运营调用" error={operationsState.error} onRetry={() => currentOverview && void loadOperations(currentOverview, filters, filterKey, sequenceRef.current).catch(() => undefined)} />}
            <AdminDataTable
              items={currentOperations.items}
              paginationLabel="官方账单运营调用分页导航"
              paginate={false}
              pageSize={20}
              minTableWidth={1640}
              resetKey={`${filterKey}:${currentOverview?.asOf ?? 'pending'}`}
              serverPagination={currentOperations.pagination}
              serverLoading={operationsState.loading}
              onServerNavigate={position => void navigateOperations(position)}
              gridTemplate="minmax(220px,1.1fr) minmax(220px,1.1fr) minmax(190px,.9fr) minmax(150px,.7fr) minmax(180px,.8fr) minmax(300px,1.3fr) minmax(190px,.9fr)"
              columns={[
                { header: '发起人', render: item => operationalOwner(item) },
                { header: '用途 / 调用', render: item => <Stack title={purposeLabel(item.purpose)} subtitle={`${item.operation} · ${item.operationKey}`} /> },
                { header: '服务 / 模型', render: item => <Stack title={serviceTypeLabel(item.serviceType)} subtitle={item.model ?? '未识别模型'} /> },
                { header: '状态', render: item => operationalStatusBadge(item.status) },
                { header: '发生时间', render: item => <Stack title={formatBeijingDateTime(item.occurredAt)} subtitle={item.provider} /> },
                { header: '审计证据', render: item => <Stack title={operationalEvidenceLabel(item)} subtitle={operationalEvidenceMetadataLabel(item)} /> },
                { header: '估值 / 官方归属', render: item => <Stack title={estimatedCny(item.estimatedCostCny)} subtitle={officialLinkLabel(item)} /> },
              ]}
              emptyLabel="当前筛选范围没有运营调用"
            />
          </>
        ) : (
          <ResourceBoundary state={operationsState} label="运营调用" onRetry={() => currentOverview && void loadOperations(currentOverview, filters, filterKey, sequenceRef.current).catch(() => undefined)} />
        )}
      </section>
    </PageShell>
  );
}

const SERVICE_OPTIONS: Array<{ value: ServiceTypeFilter; label: string }> = [
  { value: 'all', label: '全部服务' },
  { value: 'video', label: '视频生成' },
  { value: 'image', label: '图片生成' },
  { value: 'multimodal', label: '多模态模型' },
  { value: 'storage', label: '存储' },
  { value: 'other', label: '其他' },
];

const FINALITY_OPTIONS: Array<{ value: FinalityFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'final', label: '终账' },
  { value: 'provisional', label: '暂估' },
];

const ATTRIBUTION_OPTIONS: Array<{ value: AttributionFilter; label: string }> = [
  { value: 'all', label: '全部归属' },
  { value: 'business', label: '业务调用' },
  { value: 'admin-operational', label: '运营调用' },
  { value: 'account-level', label: '账户级' },
  { value: 'unattributed', label: '待归属' },
];

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
    </div>
  );
}

function BreakdownCard({ title, icon, rows }: {
  title: string;
  icon: ReactNode;
  rows: Array<{
    id: string;
    title: string;
    count: number;
    originalAmount: string;
    preferentialAmount: string;
    discountAmount: string;
    couponAmount: string;
    payableAmount: string;
  }>;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">{icon}{title}</div>
      <div className="mt-3 divide-y divide-white/10">
        {rows.map(row => (
          <div key={row.id} className="flex items-center justify-between gap-4 py-3 text-sm">
            <Stack title={row.title} subtitle={`${number(row.count)} 条账单`} />
            <Stack
              title={`应付 ${cny(row.payableAmount)}`}
              subtitle={`原价 ${cny(row.originalAmount)} · 优惠后 ${cny(row.preferentialAmount)} · 折扣 ${cny(row.discountAmount)} · 券 ${cny(row.couponAmount)}`}
            />
          </div>
        ))}
        {rows.length === 0 && <p className="py-6 text-center text-sm text-gray-500">当前筛选范围暂无分组数据</p>}
      </div>
    </Card>
  );
}

function ResourceBoundary<T>({ state, label, onRetry }: {
  state: ResourceState<T>;
  label: string;
  onRetry: () => void;
}) {
  if (state.loading) return <LoadingState variant="panel" />;
  return (
    <Card className="p-5 text-sm text-gray-400">
      <p>{state.error ? `${label}加载失败：${state.error}` : `${label}尚未加载`}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>重新加载</Button>
    </Card>
  );
}

function StaleNotice({ label, error, onRetry }: { label: string; error: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-orange-400/20 bg-orange-500/[0.06] p-3 text-xs text-orange-100">
      <span>{label}刷新失败，当前保留同一筛选下最近一次成功快照：{error}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>重试</Button>
    </Card>
  );
}

function startResource<T>(state: ResourceState<T>): ResourceState<T> {
  return { ...state, loading: true, error: null };
}

function resolveResource<T>(data: T, dataKey: string): ResourceState<T> {
  return { data, dataKey, loading: false, error: null };
}

function rejectResource<T>(state: ResourceState<T>, error: unknown): ResourceState<T> {
  return { ...state, loading: false, error: errorMessage(error) };
}

function withPosition<T extends { pagination: Omit<ExactCursorPagination, 'position'> & { position?: PagePosition } }>(
  page: T,
  position: PagePosition,
): Omit<T, 'pagination'> & { pagination: ExactCursorPagination } {
  return { ...page, pagination: { ...page.pagination, position } };
}

function pageCursor(pagination: ExactCursorPagination, position: PagePosition) {
  if (position === 'previous') return pagination.previousCursor;
  if (position === 'next') return pagination.nextCursor;
  return undefined;
}

function assertBillingPageConsistency(
  overview: AdminProviderBillingOverview,
  page: Pick<AdminProviderBillingDetailsPage | AdminProviderBillingOperationalUsagePage, 'asOf' | 'selection'>,
) {
  if (
    page.asOf !== overview.asOf
    || page.selection.rangeStart !== overview.selection.rangeStart
    || page.selection.rangeEnd !== overview.selection.rangeEnd
  ) {
    throw new Error('账单分页快照与汇总不一致，请刷新后重试');
  }
}

function officialBillsFilters(selection: OfficialBillsSelection): AdminProviderBillingFilters {
  return {
    range: selection.range,
    ...(selection.range === 'month' ? { month: selection.month } : {}),
    ...(selection.range === 'custom' ? { from: selection.from, to: selection.to } : {}),
    product: selection.product || undefined,
    serviceType: selection.serviceType === 'all' ? undefined : selection.serviceType,
    model: selection.model.trim() || undefined,
    finality: selection.finality === 'all' ? undefined : selection.finality,
    attributionStatus: selection.attributionStatus === 'all' ? undefined : selection.attributionStatus,
    search: selection.search.trim() || undefined,
  };
}

export function readOfficialBillsSelection(
  search = typeof window === 'undefined' ? '' : window.location.search,
): OfficialBillsSelection {
  const params = new URLSearchParams(search);
  const today = beijingToday();
  const currentMonth = today.slice(0, 7);
  const requestedRange = params.get('range');
  const requestedFrom = params.get('from');
  const requestedTo = params.get('to');
  const legacyDate = params.get('date');
  const hasCustom = (requestedRange === 'custom' || (!requestedRange && requestedFrom && requestedTo))
    && validDate(requestedFrom ?? '', today)
    && validDate(requestedTo ?? '', today)
    && requestedFrom! <= requestedTo!;
  const hasLegacyDate = requestedRange === 'date' && validDate(legacyDate ?? '', today);
  const range: BillingRange = requestedRange === 'all' ? 'all' : hasCustom || hasLegacyDate ? 'custom' : 'month';
  const requestedMonth = params.get('month') ?? currentMonth;
  const serviceValue = params.get('serviceType');
  const finalityValue = params.get('finality');
  const attributionValue = params.get('attributionStatus');
  const pointDate = hasLegacyDate ? legacyDate! : null;
  return {
    range,
    month: validMonth(requestedMonth, currentMonth) ? requestedMonth : currentMonth,
    from: pointDate ?? (hasCustom ? requestedFrom! : `${currentMonth}-01`),
    to: pointDate ?? (hasCustom ? requestedTo! : today),
    product: params.get('product')?.trim() ?? '',
    serviceType: isServiceType(serviceValue) ? serviceValue : 'all',
    model: params.get('model')?.trim() ?? '',
    finality: finalityValue === 'final' || finalityValue === 'provisional' ? finalityValue : 'all',
    attributionStatus: isAttributionStatus(attributionValue) ? attributionValue : 'all',
    search: params.get('search')?.trim() ?? '',
  };
}

export function buildOfficialBillsQuery(selection: OfficialBillsSelection) {
  const params = new URLSearchParams();
  params.set('range', selection.range);
  if (selection.range === 'month') params.set('month', selection.month);
  if (selection.range === 'custom') {
    params.set('from', selection.from);
    params.set('to', selection.to);
  }
  if (selection.product) params.set('product', selection.product);
  if (selection.serviceType !== 'all') params.set('serviceType', selection.serviceType);
  if (selection.model.trim()) params.set('model', selection.model.trim());
  if (selection.finality !== 'all') params.set('finality', selection.finality);
  if (selection.attributionStatus !== 'all') params.set('attributionStatus', selection.attributionStatus);
  if (selection.search.trim()) params.set('search', selection.search.trim());
  return params.toString();
}

function writeOfficialBillsSelection(selection: OfficialBillsSelection) {
  if (typeof window === 'undefined') return;
  const query = buildOfficialBillsQuery(selection);
  const next = `${window.location.pathname}?${query}`;
  if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState({}, '', next);
}

function billingBackQuery(selection: OfficialBillsSelection) {
  const params = new URLSearchParams();
  params.set('costType', serviceToCostType(selection.serviceType));
  if (selection.range === 'month') {
    params.set('range', 'month');
    params.set('month', selection.month);
  } else if (selection.range === 'custom') {
    params.set('range', 'custom');
    params.set('from', selection.from);
    params.set('to', selection.to);
  } else {
    const today = beijingToday();
    params.set('range', 'month');
    params.set('month', today.slice(0, 7));
  }
  return `?${params.toString()}`;
}

function serviceToCostType(service: ServiceTypeFilter) {
  if (service === 'image') return 'image';
  if (service === 'multimodal') return 'multimodal';
  return 'video';
}

function selectedRange(selection: OfficialBillsSelection, today: string) {
  if (selection.range === 'all') return '全部已同步账期';
  if (selection.range === 'custom') return `${selection.from} 至 ${selection.to}`;
  const [year, month] = selection.month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate().toString().padStart(2, '0');
  const end = selection.month === today.slice(0, 7) ? today : `${selection.month}-${lastDay}`;
  return `${selection.month}-01 至 ${end}`;
}

function serviceTypeLabel(value: string) {
  return ({
    video: '视频生成',
    image: '图片生成',
    multimodal: '多模态模型',
    storage: '存储',
    other: '其他',
  } as Record<string, string>)[value] ?? value;
}

function serviceTypeBadge(value: string) {
  const variant = value === 'video' ? 'purple' : value === 'image' ? 'blue' : value === 'multimodal' ? 'orange' : 'default';
  return <Badge variant={variant}>{serviceTypeLabel(value)}</Badge>;
}

export function attributionLabel(value: string) {
  return ({
    business: '业务调用',
    'admin-operational': '运营调用',
    'account-level': '账户级费用',
    unattributed: '待归属',
  } as Record<string, string>)[value] ?? value;
}

function finalityBadge(value: string) {
  return value === 'final'
    ? <Badge variant="success">终账</Badge>
    : <Badge variant="warning" dot>暂估</Badge>;
}

function usageLabel(item: AdminProviderBillingDetail) {
  if (item.usageCount === null || item.usageUnit === null) return '未提供';
  return `${decimal(item.usageCount)} ${item.usageUnit}`;
}

function operationalOwner(item: AdminProviderBillingOperationalUsage) {
  return (
    <Stack
      title={item.costOwnerUserName ?? item.costOwnerEmail ?? initiatorLabel(item.initiatorType)}
      subtitle={item.costOwnerEmail ?? initiatorLabel(item.initiatorType)}
    />
  );
}

function initiatorLabel(value: string) {
  return ({
    'admin-user': '管理员',
    'release-automation': '发布自动化',
    'maintenance-script': '维护脚本',
  } as Record<string, string>)[value] ?? value;
}

export function purposeLabel(value: string) {
  return ({
    'deployment-canary': '发布验证',
    'api-smoke-test': 'API 冒烟验证',
    'provider-diagnostic': '供应商诊断',
    'admin-direct': '管理员直连',
  } as Record<string, string>)[value] ?? value;
}

function operationalStatusBadge(status: string) {
  if (status === 'completed' || status === 'success') return <Badge variant="success">已完成</Badge>;
  if (status === 'failed') return <Badge variant="error">失败</Badge>;
  if (status === 'canceled') return <Badge variant="blue">已取消</Badge>;
  if (status === 'unknown') return <Badge variant="warning" dot>状态未知</Badge>;
  return <Badge variant="warning" dot>{status}</Badge>;
}

export function operationalEvidenceLabel(item: Pick<AdminProviderBillingOperationalUsage,
  'origin' | 'evidenceStatus' | 'evidencePath'
>) {
  if (item.evidenceStatus === 'admin-confirmed-missing-original') {
    return '管理员确认计入（原始证据缺失）';
  }
  if (item.evidenceStatus === 'verified') return item.evidencePath ?? '原始证据已核验';
  if (item.origin === 'legacy-admin-direct') return '历史管理员直连（无 manifest）';
  return item.evidencePath ?? '未提供证据路径';
}

export function operationalEvidenceMetadataLabel(item: Pick<AdminProviderBillingOperationalUsage,
  'evidenceStatus' | 'approvalSha256' | 'approvedAt' | 'evidenceSha256' | 'manifestSha256'
>) {
  if (item.evidenceStatus === 'admin-confirmed-missing-original') {
    return `审批 ${shortSha(item.approvalSha256)} · ${formatBeijingDateTime(item.approvedAt)} · 清单 ${shortSha(item.manifestSha256)}`;
  }
  return `证据 ${shortSha(item.evidenceSha256)} · 清单 ${shortSha(item.manifestSha256)}`;
}

function billLineTypeLabel(value: string) {
  return ({
    usage: '按量使用',
    'package-purchase': '资源包购买',
    refund: '退款',
    adjustment: '账单调整',
    other: '其他费用',
  } as Record<string, string>)[value] ?? value;
}

function officialLinkLabel(item: AdminProviderBillingOperationalUsage) {
  if (item.officialBillDetailId) return `已关联官方账单 · ${reconciliationLabel(item.reconciliationStatus)}`;
  return `未关联官方账单 · ${reconciliationLabel(item.reconciliationStatus)}`;
}

function shortSha(value: string | null) {
  return value ? `SHA256 ${value.slice(0, 12)}…` : '—';
}

function reconciliationLabel(value: string) {
  return ({
    matched: '已匹配',
    partial: '部分匹配',
    unmatched: '未匹配',
  } as Record<string, string>)[value] ?? value;
}

function cny(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '数据不可用';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '数据不可用';
  return `${parsed < 0 ? '-' : ''}¥${Math.abs(parsed).toFixed(6)}`;
}

function estimatedCny(value: string | null) {
  return value === null ? '估值不可用' : `${cny(value)}（列表价估算）`;
}

function decimal(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('zh-CN', { maximumFractionDigits: 6 }) : String(value);
}

function isServiceType(value: string | null): value is ServiceType {
  return value === 'video' || value === 'image' || value === 'multimodal' || value === 'storage' || value === 'other';
}

function isAttributionStatus(value: string | null): value is Exclude<AttributionFilter, 'all'> {
  return value === 'business' || value === 'admin-operational' || value === 'account-level' || value === 'unattributed';
}

function beijingToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown, fallback = '官方账单加载失败') {
  return error instanceof Error && error.message ? error.message : fallback;
}
