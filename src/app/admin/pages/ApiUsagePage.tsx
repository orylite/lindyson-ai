import {
  ArrowLeft,
  Banknote,
  Calculator,
  CalendarDays,
  Clock3,
  Coins,
  PackageCheck,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import { useEffect,useMemo,useRef,useState,type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import type { PagePosition } from '../../api/cursor';
import type {
  AdminApiCostAttempt,
  AdminApiCostAttemptFilters,
  AdminApiCostDashboard,
  AdminApiCostPageKind,
  AdminApiCostPaginationState,
  AdminApiCostReconciliationDetail,
} from '../../data/admin';
import { getAdminApiCostReconciliationDetail } from '../../api/queries';
import { Badge,Button,Card,DatePicker } from '../../ui';
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
import type { BadgeVariant } from '../components/AdminPageShared';
import type { DetailState } from '../types';

type RangeFilter = NonNullable<AdminApiCostAttemptFilters['range']>;
type ModelFilter = 'all' | 'Seedance 2.5' | 'Seedance 2.0' | 'Seedance 2.0 Fast' | 'Seedance 2.0 Mini';
type ResolutionFilter = 'all' | NonNullable<AdminApiCostAttemptFilters['pricingResolution']>;
type InputFilter = 'all' | NonNullable<AdminApiCostAttemptFilters['inputClass']>;
type TaskStatusFilter = 'all' | NonNullable<AdminApiCostAttemptFilters['status']>;
type PricingFilter = 'all' | NonNullable<AdminApiCostAttemptFilters['pricingRuleStatus']>;
type EvidenceFilter = 'all' | NonNullable<AdminApiCostAttemptFilters['usageEvidenceOrigin']>;
type ConfidenceFilter = 'all' | NonNullable<AdminApiCostAttemptFilters['attributionConfidence']>;
type EstimateCompleteness = AdminApiCostDashboard['summary']['localEstimateCompleteness'];

const MODEL_OPTIONS = new Set<ModelFilter>([
  'all', 'Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini',
]);

export function AdminApiUsagePage({ dashboard, attempts, pagination, onDetailsLoad, onCancel, onPageNavigate, onSync, onNavigate, setDetail }: {
  dashboard: AdminApiCostDashboard;
  attempts: AdminApiCostAttempt[];
  pagination: AdminApiCostPaginationState;
  onDetailsLoad: (filters?: AdminApiCostAttemptFilters) => Promise<void>;
  onCancel: () => void;
  onPageNavigate: (kind: AdminApiCostPageKind, position: PagePosition) => Promise<void>;
  onSync: () => Promise<void>;
  onNavigate: (path: string) => void;
  setDetail: (detail: DetailState) => void;
}) {
  const [initialSelection] = useState(readUrlSelection);
  const [range, setRange] = useState<RangeFilter>(initialSelection.range);
  const [month, setMonth] = useState(initialSelection.month);
  const [date, setDate] = useState(initialSelection.date);
  const [from, setFrom] = useState(initialSelection.from);
  const [to, setTo] = useState(initialSelection.to);
  const [model, setModel] = useState<ModelFilter>(initialSelection.model);
  const [search, setSearch] = useState('');
  const [resolution, setResolution] = useState<ResolutionFilter>('all');
  const [inputClass, setInputClass] = useState<InputFilter>('all');
  const [taskStatus, setTaskStatus] = useState<TaskStatusFilter>('all');
  const [pricingStatus, setPricingStatus] = useState<PricingFilter>('all');
  const [evidenceOrigin, setEvidenceOrigin] = useState<EvidenceFilter>('all');
  const [confidence, setConfidence] = useState<ConfidenceFilter>('all');
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const detailRequestRef = useRef(0);
  const today = beijingToday();
  const currentMonth = today.slice(0, 7);

  useEffect(() => onCancel, [onCancel]);

  const filters = useMemo<AdminApiCostAttemptFilters>(() => ({
    range,
    ...(range === 'month' ? { month } : {}),
    ...(range === 'date' ? { date } : {}),
    ...(range === 'custom' ? { from, to } : {}),
    model: model === 'all' ? undefined : model,
    pricingResolution: resolution === 'all' ? undefined : resolution,
    inputClass: inputClass === 'all' ? undefined : inputClass,
    status: taskStatus === 'all' ? undefined : taskStatus,
    pricingRuleStatus: pricingStatus === 'all' ? undefined : pricingStatus,
    usageEvidenceOrigin: evidenceOrigin === 'all' ? undefined : evidenceOrigin,
    attributionConfidence: confidence === 'all' ? undefined : confidence,
    search: search.trim() || undefined,
  }), [confidence, date, evidenceOrigin, from, inputClass, model, month, pricingStatus, range, resolution, search, taskStatus, to]);
  const tableResetKey = useMemo(
    () => `${dashboard.asOf}:${JSON.stringify(filters)}`,
    [dashboard.asOf, filters],
  );

  useEffect(() => {
    writeUrlSelection({ range, month, date, from, to, model });
  }, [date, from, model, month, range, to]);

  useEffect(() => {
    const restore = () => {
      const next = readUrlSelection();
      setRange(next.range);
      setMonth(next.month);
      setDate(next.date);
      setFrom(next.from);
      setTo(next.to);
      setModel(next.model);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    const requestId = ++detailRequestRef.current;
    const timeout = window.setTimeout(() => {
      setLoadingDetails(true);
      void onDetailsLoad(filters)
        .catch(error => {
          if (detailRequestRef.current === requestId && !isAbortError(error)) {
            toast.error(error instanceof Error ? error.message : '高级对账加载失败');
          }
        })
        .finally(() => {
          if (detailRequestRef.current === requestId) setLoadingDetails(false);
        });
    }, search ? 300 : 0);
    return () => {
      window.clearTimeout(timeout);
      if (detailRequestRef.current === requestId) detailRequestRef.current += 1;
    };
  }, [filters, onDetailsLoad, search]);

  const priceRows = useMemo(() => buildPriceRows(dashboard.pricingRules), [dashboard.pricingRules]);
  const chartData = useMemo(
    () => buildApiCostChartData(dashboard.daily, dashboard.selection.grain),
    [dashboard.daily, dashboard.selection.grain],
  );
  const partialTrendPeriods = dashboard.daily.filter(row => row.localEstimateCompleteness === 'partial').length;
  const unavailableTrendPeriods = dashboard.daily.filter(row => row.localEstimateCompleteness === 'unavailable').length;
  const hasTrendData = chartData.some(row => (
    row['本地列表价估算'] !== null
    || row['官方用量列表价折算'] !== null
    || row['用量账单应付'] !== null
  ));
  const summary = dashboard.summary;
  const noPackageProjection = formatNoPackageProjection(summary, dashboard.account.availableBalanceCny);
  const usage = dashboard.books.usage;
  const valuation = dashboard.books.valuation;
  const settlement = dashboard.books.settlement;
  const syncLabel = dashboard.sync.status === 'normal' ? '同步正常' : dashboard.sync.status === 'error' ? '同步异常' : '数据需关注';
  const syncVariant = dashboard.sync.status === 'normal' ? 'success' : dashboard.sync.status === 'error' ? 'error' : 'warning';

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await onSync();
      await onDetailsLoad(filters);
    } catch (error) {
      if (!isAbortError(error)) toast.error(error instanceof Error ? error.message : '同步请求提交失败');
    } finally {
      setSyncing(false);
    }
  };

  const handlePageNavigate = async (kind: AdminApiCostPageKind, position: PagePosition) => {
    try {
      await onPageNavigate(kind, position);
    } catch (error) {
      if (!isAbortError(error)) toast.error(error instanceof Error ? error.message : '成本明细翻页失败');
    }
  };

  return (
    <PageShell
      width="cost"
      eyebrow="COST RECONCILIATION"
      title="高级成本对账"
      subtitle="查看 Token、价格、账单、历史补记与供应商 attempt 证据；日常经营请返回成本看盘"
      action={(
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => onNavigate(buildApiCostOverviewPath(
              { range, month, date, from, to, model },
              { rangeStart: dashboard.selection.rangeStart, rangeEnd: dashboard.selection.rangeEnd },
            ))}
          >
            返回成本看盘
          </Button>
          <Button variant="secondary" size="sm" loading={syncing} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void handleSync()}>同步费用中心</Button>
        </div>
      )}
    >
      <Card className="p-4">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-white">高级对账范围</h2>
              <Badge variant={combinedStatusVariant(dashboard.combinedStatus.matchState)} dot>{dashboard.combinedStatus.label}</Badge>
              {loadingDetails && <Badge variant="purple" dot>正在更新</Badge>}
            </div>
            <p className="mt-2 text-xs text-gray-500">时间与模型会联动三本账、对账矩阵、趋势、结算和供应商 attempt；日期均按北京时间切账。</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <FilterChips value={range} onChange={setRange} label="看盘" options={[
              { value: 'all', label: '全部' },
              { value: 'month', label: '月份' },
              { value: 'date', label: '日期' },
              { value: 'custom', label: '自选周期' },
            ]} />
            {range === 'month' && (
              <DatePicker mode="month" size="filter" label="月份" value={month} max={currentMonth} onValueChange={value => setMonth(validMonth(value, currentMonth) ? value : currentMonth)} />
            )}
            {range === 'date' && (
              <DatePicker mode="date" size="filter" label="日期" value={date} max={today} onValueChange={value => setDate(validDate(value, today) ? value : today)} />
            )}
            {range === 'custom' && (
              <>
                <DatePicker
                  mode="date"
                  size="filter"
                  label="开始日期"
                  value={from}
                  max={today}
                  onValueChange={value => {
                    const next = validDate(value, today) ? value : from;
                    setFrom(next);
                    if (next > to) setTo(next);
                  }}
                />
                <DatePicker
                  mode="date"
                  size="filter"
                  label="结束日期"
                  value={to}
                  max={today}
                  onValueChange={value => {
                    const next = validDate(value, today) ? value : to;
                    setTo(next);
                    if (next < from) setFrom(next);
                  }}
                />
              </>
            )}
            <SelectFilter value={model} onChange={setModel} label="模型" options={[
              { value: 'all', label: '全部模型' },
              { value: 'Seedance 2.5', label: '2.5' },
              { value: 'Seedance 2.0', label: '2.0' },
              { value: 'Seedance 2.0 Fast', label: 'Fast' },
              { value: 'Seedance 2.0 Mini', label: 'Mini' },
            ]} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
          <span>当前范围：{dashboard.selection.rangeStart} 至 {dashboard.selection.rangeEnd} · {grainLabel(dashboard.selection.grain)}</span>
          <span>统一数据截点：{formatBeijingDateTime(dashboard.asOf)}</span>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-white">当前账户快照</h2>
              <Badge variant={syncVariant} dot>{syncLabel}</Badge>
              <Badge variant="default">不随历史筛选变化</Badge>
            </div>
            <p className="mt-2 text-xs text-gray-500">余额、资源包余量、当前价格和无套餐预测属于当前时点状态，不分摊到历史模型或日期。</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>快照捕获：{formatBeijingDateTime(dashboard.currentState.capturedAt)}</p>
            <p className="mt-1">最后成功同步：{formatBeijingDateTime(dashboard.sync.lastSyncedAt)}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {dashboard.sync.items.map(item => (
            <div key={item.kind} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-300">{syncKindLabel(item.kind)}</span>
                {syncFreshnessBadge(item.status)}
              </div>
              <p className="mt-2 text-xs text-gray-500">成功：{formatBeijingDateTime(item.lastSuccessAt)}</p>
              <p className="mt-1 text-xs text-gray-500">数据截至：{item.dataThrough}</p>
              {item.reason && <p className="mt-2 line-clamp-2 text-xs text-amber-300">{item.reason}</p>}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard icon={WalletCards} label="全账户可用余额" value={cny(dashboard.account.availableBalanceCny)} helper={`现金 ${cny(dashboard.account.cashBalanceCny)} · 冻结 ${cny(dashboard.account.frozenAmountCny)}`} tone="purple" />
        <MetricCard
          icon={Coins}
          label="今日列表价估算"
          value={cny(summary.todayEstimatedCostCny)}
          helper={localEstimateHelper(
            summary.todayEstimatedCostCny,
            summary.todayEstimateCompleteness,
            '北京时间今日已记录任务的列表价估算，不等于官方实际应付',
            summary.todayUnpricedAttempts,
            summary.todayUnavailableUsageAttempts,
          )}
          tone="blue"
        />
        <MetricCard
          icon={CalendarDays}
          label="当前月列表价估算"
          value={cny(summary.monthEstimatedCostCny)}
          helper={localEstimateHelper(
            summary.monthEstimatedCostCny,
            summary.monthEstimateCompleteness,
            '北京时间当前自然月已记录任务的列表价估算',
            summary.monthUnpricedAttempts,
            summary.monthUnavailableUsageAttempts,
          )}
          tone="green"
        />
        <MetricCard
          icon={Banknote}
          label="所选范围官方实际应付"
          value={cny(summary.officialPayableAmountCny)}
          helper={`${summary.rangeStart} 至 ${summary.rangeEnd} · ${billStatusLabel(summary.billStatus)} · ${coverageLabel(dashboard.coverage.official.status)}${dashboard.coverage.official.reason ? `；${dashboard.coverage.official.reason}` : ''}`}
          tone="pink"
        />
        <MetricCard
          icon={Clock3}
          label="停止购包后预测"
          value={noPackageProjection.value}
          helper={noPackageProjection.helper}
          tone="orange"
        />
        <MetricCard
          icon={RefreshCw}
          label="费用中心最后同步"
          value={dashboard.sync.lastSyncedAt === '-' ? '数据不可用' : formatBeijingDateTime(dashboard.sync.lastSyncedAt)}
          helper={`${syncLabel} · 统一数据截点 ${formatBeijingDateTime(dashboard.asOf)}`}
          tone="blue"
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-gray-400">
        <span><PackageCheck className="mr-1.5 inline h-3.5 w-3.5" />当前资源包实例 {number(dashboard.packages.length)} 个</span>
        <span><CalendarDays className="mr-1.5 inline h-3.5 w-3.5" />当前价格规则 {number(dashboard.pricingRules.length)} 条</span>
        <span>余额、资源包和价格均为当前快照，不随历史筛选分摊。</span>
      </div>

      {summary.localUnpricedAttempts !== null && summary.localUnpricedAttempts > 0 && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4" role="alert">
          <p className="text-sm font-semibold text-amber-200">本地存在正 Token 未计价用量</p>
          <p className="mt-1 text-xs text-amber-100/80">
            {number(summary.localUnpricedAttempts)} 次尝试、{summary.localUnpricedTokens === null ? 'Token 数据不可用' : `${number(summary.localUnpricedTokens)} Token`} 尚未匹配有效价格；页面继续展示已知列表价小计，但它不代表完整成本，未知金额不会被当作 0。
          </p>
        </div>
      )}

      {summary.localUnavailableUsageAttempts !== null && summary.localUnavailableUsageAttempts > 0 && (
        <div className="rounded-2xl border border-orange-400/25 bg-orange-400/5 p-4" role="alert">
          <p className="text-sm font-semibold text-orange-200">本地存在供应商用量缺失</p>
          <p className="mt-1 text-xs text-orange-100/80">
            {number(summary.localUnavailableUsageAttempts)} 次尝试未取得 billable Token；这类记录与“已知正 Token 但缺少价格”分开统计，当前金额仅为已知小计，不能据此认定总成本完整。
          </p>
        </div>
      )}

      {summary.officialUnpricedRows !== null && summary.officialUnpricedRows > 0 && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4" role="alert">
          <p className="text-sm font-semibold text-amber-200">官方账单存在未归一计价行</p>
          <p className="mt-1 text-xs text-amber-100/80">
            {number(summary.officialUnpricedRows)} 行、{summary.officialUnpricedTokens === null ? '数据不可用' : number(summary.officialUnpricedTokens)} Token 尚未识别标准单价；官方列表价、抵扣价值和成本残差均不完整，不能据此判断已经对齐。
          </p>
        </div>
      )}

      <section className="space-y-3">
        <SectionHeading title="三本账摘要" description="用量是否完整、列表价值多少钱、官方如何结算必须分别判断，不能交叉相减。" />
        {dashboard.coverage.comparable.status === 'unavailable' && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200" role="status">
            当前所选范围没有可用的本地与官方共同覆盖窗口；用量完整性账和列表价估值账显示“数据不可用”，不会用 0 伪装成已核对。
          </div>
        )}
        <div className="grid gap-4 xl:grid-cols-3">
          <BookCard icon={<Coins className="h-5 w-5 text-blue-300" />} title="用量完整性账" subtitle="仅在共同可比范围核对供应商用量是否被本地完整记录">
            <BookMetric label="本地原始采集" value={formatBookToken(usage.rawLocalTokens)} />
            <BookMetric label="账单匹配推断" value={formatBookToken(usage.inferredAdjustmentTokens, true)} warning={isNonZeroNumber(usage.inferredAdjustmentTokens)} />
            <BookMetric label="调整后本地" value={formatBookToken(usage.adjustedLocalTokens)} />
            <BookMetric label="官方用量" value={formatBookToken(usage.officialTokens)} />
            <BookMetric label="未解释残差" value={formatBookToken(usage.residualTokens, true)} warning={isNonZeroNumber(usage.residualTokens)} />
            <div className="col-span-2 rounded-xl bg-white/5 p-3 text-xs text-gray-400">
              原始覆盖率 {percent(usage.rawCoveragePercent)} · 调整后覆盖率 {percent(usage.adjustedCoveragePercent)} · 跨日移动 {formatBookToken(usage.timingShiftTokens, true)}
            </div>
          </BookCard>

          <BookCard icon={<Calculator className="h-5 w-5 text-purple-300" />} title="列表价估值账" subtitle="仅在共同可比范围按标准化价格桶评估相同用量价值">
            <BookMetric label="本地原始估值" value={cny(valuation.rawLocalCostCny)} />
            <BookMetric label="推断调整" value={cny(valuation.inferredAdjustmentCostCny)} warning={isNonZeroCny(valuation.inferredAdjustmentCostCny)} />
            <BookMetric label="调整后本地" value={cny(valuation.adjustedLocalCostCny)} />
            <BookMetric label="官方用量列表价折算" value={cny(valuation.officialListEquivalentCostCny)} />
            <BookMetric label="未解释残差" value={cny(valuation.residualCostCny)} warning={isNonZeroCny(valuation.residualCostCny)} />
            <BookMetric label="费率差" value={varianceCny(valuation.rateVarianceCny)} warning={isNonZeroCny(valuation.rateVarianceCny)} />
            <BookMetric label="舍入差" value={varianceCny(valuation.roundingVarianceCny)} warning={isNonZeroCny(valuation.roundingVarianceCny)} />
            <div className="col-span-2 rounded-xl bg-white/5 p-3 text-xs text-gray-400">
              跨日移动 {cny(valuation.timingShiftCostCny)}；“未独立计算”不等于零，相关金额仍保留在未解释残差。
            </div>
            <div className="col-span-2 flex flex-wrap items-center gap-2 rounded-xl bg-white/5 p-3 text-xs text-gray-400">
              <span>本地：</span>{estimateCompletenessBadge(valuation.localEstimateCompleteness)}
              <span>官方：</span>{estimateCompletenessBadge(valuation.officialEstimateCompleteness)}
              <span>{estimateCompletenessDescription(valuation.localEstimateCompleteness, null, null)}</span>
            </div>
          </BookCard>

          <BookCard icon={<Banknote className="h-5 w-5 text-emerald-300" />} title="财务结算账" subtitle="使用所选官方范围，不因本地缺少共同覆盖而裁剪">
            <BookMetric label="用量账单应付" value={cny(settlement.usagePayableAmountCny)} />
            <BookMetric label="资源包购买实付" value={cny(settlement.packagePurchasePaidAmountCny)} />
            <BookMetric label="按量现金应付" value={cny(settlement.paygPayableAmountCny)} />
            <BookMetric label="用量未付" value={cny(settlement.usageUnpaidAmountCny)} warning={isNonZeroCny(settlement.usageUnpaidAmountCny)} />
            <BookMetric label="退款" value={cny(settlement.refundAmountCny)} warning={isNonZeroCny(settlement.refundAmountCny)} />
            <BookMetric label="账单调账" value={cny(settlement.billingAdjustmentAmountCny)} warning={isNonZeroCny(settlement.billingAdjustmentAmountCny)} />
            <BookMetric label="官方净应付" value={cny(settlement.netOfficialPayableCny)} />
            <BookMetric label="真实消耗摊销" value={nullableCny(settlement.amortizedCostCny)} />
            <BookMetric label="期初补记" value={nullableCny(settlement.openingCatchUpCny)} />
            <BookMetric label="期末预付资产" value={nullableCny(settlement.endingPrepaidAssetCny)} />
            <div className="col-span-2 space-y-1 rounded-xl bg-white/5 p-3 text-xs text-gray-400">
              <p>官方结算范围：{settlement.rangeStart} 至 {settlement.rangeEnd} · {coverageLabel(settlement.coverageStatus)}</p>
              {settlement.coverageReason && <p className="text-amber-300">{settlement.coverageReason}</p>}
              <p>摊销状态：{allocationStatusLabel(settlement.allocationStatus)} · 列表价抵扣价值 {listPriceOffsetLabel(settlement)}</p>
              <p>时间归属：{timeAttributionStatusLabel(settlement.timeAttributionStatus)}</p>
              {settlement.timeAttributionReason && <p className="text-amber-300">{settlement.timeAttributionReason}</p>}
              <p>资源包成本基础：期初 {nullableCny(settlement.openingPrepaidAssetCny)} · 购置 {nullableCny(settlement.acquisitionCostCny)} · 期初补记 {nullableCny(settlement.openingCatchUpCny)} · 真实消耗摊销 {nullableCny(settlement.amortizedCostCny)} · 到期损失 {nullableCny(settlement.expiryLossCny)} · 调账 {nullableCny(settlement.adjustmentCny)} · 期末 {nullableCny(settlement.endingPrepaidAssetCny)}</p>
              {settlement.allocationStatus !== 'complete' && <p>退款、调账或成本基础待归因时不展示资源包资产与摊销金额。</p>}
            </div>
          </BookCard>
        </div>
      </section>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeading title="数据覆盖范围" description="“全部”只在本地与官方共同覆盖期间正式对账，单边历史不会被误判成漏记。" compact />
          <Badge variant={coverageVariant(dashboard.combinedStatus.coverageState)}>{coverageLabel(dashboard.combinedStatus.coverageState)}</Badge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <CoverageWindow title="本地采集" window={dashboard.coverage.local} />
          <CoverageWindow title="官方账单" window={dashboard.coverage.official} />
          <CoverageWindow title="正式可比" window={dashboard.coverage.comparable} />
        </div>
        {dashboard.coverage.excludedPeriods.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">
            历史不可比：{dashboard.coverage.excludedPeriods.map(item => `${item.start} 至 ${item.end}（${item.reason}）`).join('；')}
          </div>
        )}
      </Card>

      <section className="space-y-3">
        <SectionHeading title="用量与估值对账矩阵" description="按账期、模型、计价分辨率档、视频输入档和单价归一；任务 ID 仅作为内部溯源证据。" />
        <AdminDataTable
          items={dashboard.reconciliation.items}
          paginationLabel="用量与估值对账矩阵分页导航"
          pageSize={10}
          resetKey={`${tableResetKey}:reconciliation`}
          serverPagination={pagination.reconciliation}
          serverLoading={loadingDetails || pagination.reconciliation.loading}
          onServerNavigate={position => void handlePageNavigate('reconciliation', position)}
          gridTemplate="1fr 1.1fr .9fr .8fr .8fr .8fr .8fr .8fr 1fr"
          columns={[
            { header: '账期 / 日期', render: row => <Stack title={periodLabel(row.periodStart, row.periodEnd)} subtitle={row.expenseDate ?? '期间汇总'} /> },
            { header: '模型', render: row => <Stack title={row.model} subtitle={billLineTypeLabel(row.billLineType)} /> },
            { header: '计价档', render: row => <Stack title={resolutionBandLabel(row.resolutionBand)} subtitle={`${inputClassLabel(row.inputClass)} · ${row.unitPriceCnyPerMillion ? cnyPerMillion(row.unitPriceCnyPerMillion) : '单价未知'}`} /> },
            { header: '官方 Token', render: row => number(row.officialTokens) },
            { header: '原始本地', render: row => number(row.rawLocalTokens) },
            { header: '推断调整', render: row => signedNumber(row.inferredAdjustmentTokens) },
            { header: '调整后本地', render: row => number(row.adjustedLocalTokens) },
            { header: '未解释残差', render: row => <span className={row.residualTokens !== 0 ? 'text-amber-300' : 'text-gray-300'}>{signedNumber(row.residualTokens)}</span> },
            { header: '状态', render: row => <Stack title={matchStateBadge(row.matchState)} subtitle={`归因：${confidenceLabel(row.attributionConfidence)}`} /> },
          ]}
          onRowClick={row => setDetail({
            title: `${row.model} · ${periodLabel(row.periodStart, row.periodEnd)}`,
            subtitle: '对账桶快照与证据链',
            content: <ReconciliationEvidenceDetail row={row} asOf={dashboard.asOf} />,
            wide: true,
          })}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {dashboard.models.map(item => (
          <Card key={item.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-white">{item.model}</h2>
                <p className="mt-1 text-xs text-gray-500">{item.provider}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {estimateCompletenessBadge(item.estimateCompleteness)}
                <Badge variant={item.billableTokens === null ? 'default' : isNonZeroNumber(item.unpricedTasks) ? 'warning' : 'purple'}>
                  {item.costSharePercent === null
                    ? '估算成本贡献不可用'
                    : `${item.costSharePercent.toFixed(2)}% ${item.estimateCompleteness === 'partial' ? '已知估算小计贡献' : '估算成本贡献'}`}
                </Badge>
              </div>
            </div>
            <p className="mt-5 text-2xl font-bold text-white">{cny(item.estimatedCostCny)}</p>
            <p className="mt-1 text-xs text-gray-500">{item.estimateCompleteness === 'partial' ? '所选范围列表价已知小计' : '所选范围列表价估算'} · {formatBookToken(item.billableTokens)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <MiniMetric label="真实尝试 / 任务" value={`${nullableNumber(item.attemptCount)} / ${nullableNumber(item.taskCount)}`} />
              <MiniMetric label="成功视频" value={nullableNumber(item.successfulVideoCount)} />
              <MiniMetric label="单个成功视频估算成本" value={cny(item.costPerSuccessfulVideoCny)} />
              <MiniMetric label="成功输出时长" value={item.successfulOutputSeconds === null ? '数据不可用' : `${number(item.successfulOutputSeconds)} 秒`} />
              <MiniMetric label="每输出秒估算成本" value={cny(item.costPerOutputSecondCny)} />
              <MiniMetric label="失败估算成本" value={cny(item.failedEstimatedCostCny)} warning={isNonZeroNumber(item.failedTasks)} />
              <MiniMetric label="正 Token 未计价" value={nullableNumber(item.unpricedTasks)} warning={isNonZeroNumber(item.unpricedTasks)} />
              <MiniMetric label="用量缺失尝试" value={nullableNumber(item.unavailableUsageAttempts)} warning={isNonZeroNumber(item.unavailableUsageAttempts)} />
              <MiniMetric label="不含视频输入" value={cny(item.withoutVideoCostCny)} />
              <MiniMetric label="包含视频输入" value={cny(item.withVideoCostCny)} />
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionHeading title="范围成本趋势" description="本地估值、官方用量列表价折算和用量账单应付分别绘制，官方未覆盖期间不会补零。" compact />
          <div className="flex flex-wrap items-center gap-2">
            {partialTrendPeriods > 0 && <Badge variant="warning">部分估值 {number(partialTrendPeriods)} 个周期</Badge>}
            {unavailableTrendPeriods > 0 && <Badge variant="default">估值不可用 {number(unavailableTrendPeriods)} 个周期</Badge>}
            <Badge variant="blue">{grainLabel(dashboard.selection.grain)} · 人民币</Badge>
          </div>
        </div>
        {partialTrendPeriods > 0 && (
          <p className="mb-3 text-xs text-amber-300" role="status">部分估值周期仍按已知成本小计绘制；正 Token 未计价或用量缺失的金额不包含在曲线中。</p>
        )}
        {hasTrendData ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="localCost" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
                  <linearGradient id="officialCost" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={value => `¥${Number(value).toFixed(0)}`} width={54} />
                <Tooltip contentStyle={{ background: '#151528', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, color: '#fff' }} formatter={formatTrendTooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="本地列表价估算" stroke="#8b5cf6" strokeWidth={2} fill="url(#localCost)" connectNulls={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="官方用量列表价折算" stroke="#3b82f6" strokeWidth={2} fill="url(#officialCost)" connectNulls={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="用量账单应付" stroke="#22c55e" strokeWidth={2} fill="transparent" connectNulls={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyPanel text="所选范围暂无可绘制的成本趋势；覆盖不可用不会补零。" />}
      </Card>

      <section className="space-y-3">
        <SectionHeading title="结算与资源包" description={`按官方账单范围 ${settlement.rangeStart} 至 ${settlement.rangeEnd} 展示，不受本地共同可比范围裁剪；购置成本不完整时不以列表价伪造实际成本。`} />
        <AdminDataTable
          items={dashboard.settlement.items}
          paginationLabel="结算与资源包分页导航"
          pageSize={10}
          resetKey={`${tableResetKey}:settlement`}
          serverPagination={pagination.settlement}
          serverLoading={loadingDetails || pagination.settlement.loading}
          onServerNavigate={position => void handlePageNavigate('settlement', position)}
          gridTemplate="1fr 1fr 1.1fr 1fr .8fr .8fr .8fr 1fr"
          columns={[
            { header: '费用日期', render: row => <Stack title={row.expenseDate} subtitle={row.billPeriod} /> },
            { header: '账单类型', render: row => billLineTypeLabel(row.billLineType) },
            { header: '模型 / 实例', render: row => <Stack title={row.model ?? '账户级'} subtitle={row.packageId ?? row.instanceNo ?? '不适用'} /> },
            { header: '原始金额', render: row => cny(row.originalAmountCny) },
            { header: '应付', render: row => cny(row.payableAmountCny) },
            { header: '已付', render: row => cny(row.paidAmountCny) },
            { header: '未付', render: row => <span className={row.unpaidAmountCny !== '0.000000' ? 'text-amber-300' : ''}>{cny(row.unpaidAmountCny)}</span> },
            { header: '状态', render: row => <Stack title={paymentStatusBadge(row.paymentStatus)} subtitle={`${row.isFinal ? '最终账单' : '出账中'} · ${acquisitionLinkLabel(row.acquisitionLinkStatus)}`} /> },
          ]}
        />
      </section>

      <Card className="p-4">
        <SearchFilter search={search} onSearch={setSearch} placeholder="搜索用户、邮箱、内部任务 ID 或供应商任务 ID...">
          <SelectFilter value={resolution} onChange={setResolution} label="计价档" options={[
            { value: 'all', label: '全部' }, { value: '480p-720p', label: '480P/720P' }, { value: '1080p', label: '1080P' }, { value: '4k', label: '4K' }, { value: 'unknown', label: '未知' },
          ]} />
          <SelectFilter value={inputClass} onChange={setInputClass} label="输入档" options={[
            { value: 'all', label: '全部' }, { value: 'without-video', label: '不含视频' }, { value: 'with-video', label: '含视频' }, { value: 'unknown', label: '未知' },
          ]} />
          <SelectFilter value={taskStatus} onChange={setTaskStatus} label="任务" options={[
            { value: 'all', label: '全部' }, { value: 'completed', label: '成功' }, { value: 'failed', label: '失败' }, { value: 'canceled', label: '取消' },
          ]} />
          <SelectFilter value={evidenceOrigin} onChange={setEvidenceOrigin} label="用量证据" options={[
            { value: 'all', label: '全部' }, { value: 'provider-reported', label: '供应商回执' }, { value: 'legacy-raw', label: '本地旧记录推算' }, { value: 'official-bill-inferred', label: '账单匹配推断' }, { value: 'unavailable', label: '未取得用量' },
          ]} />
          <SelectFilter value={pricingStatus} onChange={setPricingStatus} label="计价" options={[
            { value: 'all', label: '全部' }, { value: 'priced', label: '已计价' }, { value: 'rule-missing', label: '未匹配价格规则' }, { value: 'unsupported', label: '平台不支持' },
          ]} />
          <SelectFilter value={confidence} onChange={setConfidence} label="可信度" options={[
            { value: 'all', label: '全部' }, { value: 'direct', label: '直接' }, { value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }, { value: 'unallocated', label: '未归因' },
          ]} />
        </SearchFilter>
        {loadingDetails && <p className="mt-3 text-xs text-purple-300">正在保留当前看盘并加载新筛选结果…</p>}
      </Card>

      <section className="space-y-3">
        <SectionHeading title="供应商 attempt 与用量证据" description="一条记录对应一次真实供应商尝试；站内任务和归属到用户账本的 Provider 调用都在这里展示。" />
        <AdminDataTable
          items={attempts}
          paginationLabel="供应商尝试与用量证据分页导航"
          pageSize={10}
          resetKey={`${tableResetKey}:attempts`}
          serverPagination={pagination.attempts}
          serverLoading={loadingDetails || pagination.attempts.loading}
          onServerNavigate={position => void handlePageNavigate('attempts', position)}
          gridTemplate="1.25fr 1.1fr 1fr .7fr .85fr .8fr .9fr .9fr 1fr"
          columns={[
            { header: '任务', render: row => <Stack title={shortId(row.taskId ?? row.providerTaskId ?? row.id)} subtitle={`attempt ${row.attempt} · ${row.accountingDate}`} /> },
            { header: '用户', render: row => <Stack title={row.userName} subtitle={row.email} /> },
            { header: '模型', render: row => row.model },
            { header: '状态', render: row => statusBadge(row.status) },
            { header: '计价档', render: row => <Stack title={row.resolution.toUpperCase()} subtitle={inputClassLabel(row.inputClass)} /> },
            { header: 'Billable Token', render: row => row.billableTokens === null ? '未取得' : number(row.billableTokens) },
            { header: '证据 / 可信度', render: row => <Stack title={evidenceOriginLabel(row.usageEvidenceOrigin)} subtitle={confidenceLabel(row.attributionConfidence)} /> },
            { header: '列表价估算', render: row => row.estimatedCostCny ? cny(row.estimatedCostCny) : '不可计价' },
            {
              header: '成本确认 / 计价',
              render: row => row.costResolutionCaseId ? (
                <Stack
                  title={attemptCostResolutionBadge(row)}
                  subtitle={`案件 ${shortId(row.costResolutionCaseId)} · ${reconciliationCaseStatusLabel(row.costResolutionCaseStatus)} · ${pricingRuleStatusLabel(row.pricingRuleStatus)}`}
                />
              ) : (
                <Stack
                  title={row.usageEvidenceOrigin === 'official-bill-inferred' ? <Badge variant="warning">高置信账单推断</Badge> : <Badge variant="default">无任务级官方对账</Badge>}
                  subtitle={pricingRuleStatusLabel(row.pricingRuleStatus)}
                />
              ),
            },
          ]}
          onRowClick={row => setDetail({ title: row.taskId ?? row.providerTaskId ?? row.id, subtitle: `供应商 attempt ${row.attempt} 的用量与计价证据`, content: <AttemptCostDetail attempt={row} />, wide: true })}
        />
      </section>

      <section className="space-y-3">
        <SectionHeading title="受审价格版本" description="单位为元/百万 Token。价格通过审核后的迁移发布；4K 仅展示官方价格，平台未开放生成。" />
        <AdminDataTable
          items={priceRows}
          paginationLabel="受审价格版本分页导航"
          pageSize={12}
          gridTemplate="1.2fr .8fr 1fr 1fr 1.3fr .7fr"
          columns={[
            { header: '模型', render: row => row.model },
            { header: '分辨率', render: row => resolutionBandLabel(row.resolution) },
            { header: '不含视频输入', render: row => row.withoutVideo ? cnyPerMillion(row.withoutVideo) : '不支持' },
            { header: '包含视频输入', render: row => row.withVideo ? cnyPerMillion(row.withVideo) : '不支持' },
            { header: '价格版本', render: row => <Stack title={row.version} subtitle={formatBeijingDateTime(row.effectiveFrom)} /> },
            { header: '平台状态', render: row => row.platformAvailable ? <Badge variant="success">已开放</Badge> : <Badge variant="default">未开放</Badge> },
          ]}
        />
      </section>

      <details className="group rounded-2xl border border-white/10 bg-white/[0.03]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-semibold text-white">
          <span>当前资源包实例</span>
          <Badge variant={dashboard.packages.length > 0 ? 'blue' : 'default'}>{number(dashboard.packages.length)} 个</Badge>
        </summary>
        <div className="border-t border-white/10 p-4">
          <p className="mb-4 text-xs text-gray-500">资源包额度是供应商套餐计量单位，不是人民币余额，也不一定与 billable Token 一一对应。</p>
          {dashboard.packages.length > 0 ? (
            <AdminDataTable
              items={dashboard.packages}
              paginationLabel="当前资源包实例分页导航"
              pageSize={8}
              gridTemplate="1.4fr 1fr .7fr .7fr 1fr"
              columns={[
                { header: '资源包', render: row => <Stack title={row.product} subtitle={row.packageId} /> },
                { header: '识别模型', render: row => row.recognizedModel },
                { header: '总额度', render: row => number(row.totalQuota) },
                { header: '剩余额度', render: row => number(row.remainingQuota) },
                { header: '到期', render: row => formatBeijingDateTime(row.expiresAt) },
              ]}
            />
          ) : <EmptyPanel text="当前没有有效 Seedance 资源包；这不会被判定为同步异常。" />}
        </div>
      </details>
    </PageShell>
  );
}

function SectionHeading({ title, description, compact = false }: { title: string; description: string; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'px-0.5'}>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
    </div>
  );
}

function BookCard({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-white/5 p-2.5">{icon}</div>
        <div><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-1 text-xs text-gray-500">{subtitle}</p></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">{children}</div>
    </Card>
  );
}

function BookMetric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-gray-500">{label}</p><p className={`mt-1 text-sm font-semibold ${warning ? 'text-amber-300' : 'text-white'}`}>{value}</p></div>;
}

function CoverageWindow({ title, window }: { title: string; window: AdminApiCostDashboard['coverage']['local'] }) {
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-gray-300">{title}</span><Badge variant={coverageVariant(window.status)}>{coverageLabel(window.status)}</Badge></div>
      <p className="mt-2 text-sm text-white">{window.start && window.end ? `${window.start} 至 ${window.end}` : '暂无覆盖数据'}</p>
      {window.reason && <p className="mt-1 text-xs text-gray-500">{window.reason}</p>}
    </div>
  );
}

function MiniMetric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className="rounded-xl bg-white/5 p-3"><p className="text-gray-500">{label}</p><p className={`mt-1 font-semibold ${warning ? 'text-amber-300' : 'text-white'}`}>{value}</p></div>;
}

function EmptyPanel({ text }: { text: string }) {
  return <p className="rounded-xl bg-white/5 p-5 text-center text-sm text-gray-500">{text}</p>;
}

function AttemptCostDetail({ attempt }: { attempt: AdminApiCostAttempt }) {
  const rows = [
    ['内部任务 ID', attempt.taskId ?? '不适用（Provider 调用）'],
    ['供应商任务 ID', attempt.providerTaskId ?? '未返回'],
    ['真实 attempt', String(attempt.attempt)],
    ['会计日期', attempt.accountingDate],
    ['计价 Token', attempt.billableTokens === null ? '未取得' : number(attempt.billableTokens)],
    ['计价依据', billableBasisLabel(attempt.billableBasis)],
    ['completion_tokens', attempt.completionTokens === null ? '未返回' : number(attempt.completionTokens)],
    ['total_tokens（仅留存）', attempt.totalTokens === null ? '未返回' : number(attempt.totalTokens)],
    ['用量证据', evidenceOriginLabel(attempt.usageEvidenceOrigin)],
    ['归因可信度', confidenceLabel(attempt.attributionConfidence)],
    ['价格版本', attempt.pricingVersion ?? '未命中'],
    ['单价', attempt.unitPriceCnyPerMillion ? cnyPerMillion(attempt.unitPriceCnyPerMillion) : '未命中'],
    ['列表价估算成本', attempt.estimatedCostCny ? cny(attempt.estimatedCostCny) : '不可计价'],
    ['计价状态', pricingRuleStatusLabel(attempt.pricingRuleStatus)],
    ...(attempt.costResolutionCaseId ? [
      ['成本确认', costResolutionStatusLabel(attempt.costResolutionStatus)],
      ['对账案件', attempt.costResolutionCaseId],
      ['案件状态', reconciliationCaseStatusLabel(attempt.costResolutionCaseStatus)],
      ['案件证据', formatResolutionEvidence(attempt.costResolutionEvidence)],
    ] : []),
    ['账单归因', attempt.usageEvidenceOrigin === 'official-bill-inferred'
      ? '经审核的高置信账单归因，不等于官方逐单对账'
      : '未建立官方账单行到内部任务的直接映射'],
    ['官方对账边界', '官方账单无内部任务 ID，不能逐单对账'],
    ['供应商终态时间', formatBeijingDateTime(attempt.providerTerminalAt)],
    ['用量观测时间', formatBeijingDateTime(attempt.usageObservedAt)],
    ['记录创建时间', formatBeijingDateTime(attempt.createdAt)],
    ['错误', attempt.error ?? '无'],
  ];
  return <div className="grid gap-3 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 break-all text-sm text-white">{value}</p></div>)}</div>;
}

function attemptCostResolutionBadge(attempt: AdminApiCostAttempt) {
  if (attempt.costResolutionStatus === 'pending-final-bill') return <Badge variant="warning" dot>待最终账单确认</Badge>;
  if (attempt.costResolutionStatus === 'approved-zero') return <Badge variant="success">审计确认零成本</Badge>;
  if (attempt.costResolutionStatus === 'unresolved') return <Badge variant="error">待补用量</Badge>;
  return <Badge variant="default">用量已记录</Badge>;
}

function costResolutionStatusLabel(status: AdminApiCostAttempt['costResolutionStatus']) {
  return ({
    recorded: '用量已记录',
    'pending-final-bill': '待最终账单确认',
    'approved-zero': '审计确认零成本',
    unresolved: '待补用量',
  } as const)[status];
}

function reconciliationCaseStatusLabel(status: AdminApiCostAttempt['costResolutionCaseStatus']) {
  if (status === 'open') return '待复核';
  if (status === 'approved') return '已批准';
  if (status === 'superseded') return '已失效';
  return '无案件';
}

function formatResolutionEvidence(evidence: AdminApiCostAttempt['costResolutionEvidence']) {
  if (!evidence) return '未记录';
  try {
    return JSON.stringify(evidence);
  } catch {
    return '证据无法序列化';
  }
}

function ReconciliationDetail({ row }: { row: AdminApiCostDashboard['reconciliation']['items'][number] }) {
  const values = [
    ['账期', periodLabel(row.periodStart, row.periodEnd)],
    ['费用日期', row.expenseDate ?? '期间汇总'],
    ['模型', row.model],
    ['计价档', `${resolutionBandLabel(row.resolutionBand)} · ${inputClassLabel(row.inputClass)}`],
    ['单价', row.unitPriceCnyPerMillion ? cnyPerMillion(row.unitPriceCnyPerMillion) : '未知'],
    ['本地原始', `${number(row.rawLocalTokens)} Token / ${cny(row.rawLocalCostCny)}`],
    ['推断调整', `${signedNumber(row.inferredAdjustmentTokens)} Token / ${cny(row.inferredAdjustmentCostCny)}`],
    ['调整后本地', `${number(row.adjustedLocalTokens)} Token / ${cny(row.adjustedLocalCostCny)}`],
    ['官方', `${number(row.officialTokens)} Token / ${cny(row.officialListEquivalentCostCny)}`],
    ['跨日移动', `${signedNumber(row.timingShiftTokens)} Token / ${cny(row.timingShiftCostCny)}`],
    ['费率 / 舍入差', formatReconciliationVariancePair(row.rateVarianceCny, row.roundingVarianceCny)],
    ['未解释残差', `${signedNumber(row.residualTokens)} Token / ${cny(row.residualCostCny)}`],
  ];
  return <div className="grid gap-3 sm:grid-cols-2">{values.map(([label, value]) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-sm text-white">{value}</p></div>)}</div>;
}

function ReconciliationEvidenceDetail({
  row,
  asOf,
}: {
  row: AdminApiCostDashboard['reconciliation']['items'][number];
  asOf: string;
}) {
  const [detail, setEvidenceDetail] = useState<AdminApiCostReconciliationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setEvidenceDetail(null);
    setError(null);
    void getAdminApiCostReconciliationDetail(row.id, asOf, controller.signal)
      .then(value => {
        if (active) setEvidenceDetail(value);
      })
      .catch(reason => {
        if (active && !isAbortError(reason)) setError(reason instanceof Error ? reason.message : '对账证据加载失败');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [asOf, row.id]);

  const evidence = detail?.evidence ?? [];
  return (
    <div className="space-y-5">
      <ReconciliationDetail row={detail?.bucket ?? row} />
      <div>
        <h3 className="text-sm font-semibold text-white">证据链</h3>
        <p className="mt-1 text-xs text-gray-500">本地回执、零成本候选、官方账单行和审核后的推断调整分别列示；零成本候选是账户账单桶级结论，不是供应商逐任务零 Token 回执。</p>
      </div>
      {!detail && !error && <EmptyPanel text="正在读取该对账桶的证据快照…" />}
      {error && <p className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">{error}</p>}
      {detail && evidence.length === 0 && <EmptyPanel text="该桶当前没有可下钻的任务或账单证据。" />}
      {evidence.map(item => (
        <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={evidenceSideVariant(item.side)}>{evidenceSideLabel(item.side)}</Badge>
              <span className="text-xs text-gray-400">{confidenceLabel(item.confidence)}</span>
            </div>
            <span className="text-xs text-gray-400">{signedNumber(item.allocatedTokens)} Token · {cny(item.allocatedCostCny)}</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <EvidenceField label="内部任务" value={item.taskId ?? '不适用'} />
            <EvidenceField label="供应商任务" value={item.providerTaskId ?? '未提供'} />
            <EvidenceField label="官方账单行" value={item.sourceDetailKey ?? '不适用'} />
            <EvidenceField label="归因原因" value={item.cause ?? '直接维度匹配'} />
            {item.side === 'zero-cost-candidate' && (
              <EvidenceField label="候选状态与依据" value={zeroCostCandidateEvidenceSummary(item.evidence)} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function EvidenceField({ label, value }: { label: string; value: string }) {
  return <p className="break-all rounded-lg bg-white/5 px-3 py-2"><span className="text-gray-500">{label}：</span><span className="text-gray-200">{value}</span></p>;
}

function buildPriceRows(rules: AdminApiCostDashboard['pricingRules']) {
  const rows = new Map<string, {
    id: string;
    model: string;
    resolution: AdminApiCostDashboard['pricingRules'][number]['resolution'];
    withoutVideo: string | null;
    withVideo: string | null;
    version: string;
    effectiveFrom: string;
    platformAvailable: boolean;
  }>();
  for (const rule of rules) {
    const id = `${rule.version}:${rule.model}:${rule.resolution}`;
    const row = rows.get(id) ?? { id, model: rule.model, resolution: rule.resolution, withoutVideo: null, withVideo: null, version: rule.version, effectiveFrom: rule.effectiveFrom, platformAvailable: rule.platformAvailable };
    if (rule.inputClass === 'with-video') row.withVideo = rule.unitPriceCnyPerMillion;
    if (rule.inputClass === 'without-video') row.withoutVideo = rule.unitPriceCnyPerMillion;
    row.platformAvailable ||= rule.platformAvailable;
    rows.set(id, row);
  }
  return [...rows.values()];
}

export function readApiUsageUrlSelection(search = typeof window === 'undefined' ? '' : window.location.search) {
  const today = beijingToday();
  const currentMonth = today.slice(0, 7);
  const defaultFrom = `${currentMonth}-01`;
  const params = new URLSearchParams(search);
  const requestedRange = params.get('range');
  const requestedFrom = params.get('from') ?? '';
  const requestedTo = params.get('to') ?? '';
  const hasValidCustomRange = validDate(requestedFrom, today)
    && validDate(requestedTo, today)
    && requestedFrom <= requestedTo;
  const range: RangeFilter = requestedRange === 'all'
    || requestedRange === 'date'
    || requestedRange === 'month'
    || requestedRange === 'custom'
    ? requestedRange
    : hasValidCustomRange ? 'custom' : 'month';
  const requestedMonth = params.get('month') ?? '';
  const requestedDate = params.get('date') ?? '';
  const requestedModel = params.get('model') as ModelFilter | null;
  return {
    range,
    month: validMonth(requestedMonth, currentMonth) ? requestedMonth : currentMonth,
    date: validDate(requestedDate, today) ? requestedDate : today,
    from: hasValidCustomRange ? requestedFrom : defaultFrom,
    to: hasValidCustomRange ? requestedTo : today,
    model: requestedModel && MODEL_OPTIONS.has(requestedModel) ? requestedModel : 'all' as ModelFilter,
  };
}

function readUrlSelection() {
  return readApiUsageUrlSelection();
}

type ApiUsageUrlSelection = ReturnType<typeof readApiUsageUrlSelection>;

export function buildApiCostOverviewPath(
  selection: ApiUsageUrlSelection,
  resolvedRange?: { rangeStart: string; rangeEnd: string },
) {
  if (selection.range === 'date') {
    return `/admin/api-usage?${buildApiUsageSelectionQuery({
      ...selection, range: 'custom', from: selection.date, to: selection.date,
    })}`;
  }
  if (selection.range === 'all') {
    return `/admin/api-usage?${buildApiUsageSelectionQuery({
      ...selection,
      range: 'custom',
      from: resolvedRange?.rangeStart ?? selection.from,
      to: resolvedRange?.rangeEnd ?? selection.to,
    })}`;
  }
  return `/admin/api-usage?${buildApiUsageSelectionQuery(selection)}`;
}

export function buildApiUsageSelectionQuery(selection: ApiUsageUrlSelection) {
  const params = new URLSearchParams();
  params.set('costType', 'video');
  params.set('range', selection.range);
  if (selection.range === 'month') params.set('month', selection.month);
  if (selection.range === 'date') params.set('date', selection.date);
  if (selection.range === 'custom') {
    params.set('from', selection.from);
    params.set('to', selection.to);
  }
  if (selection.model !== 'all') params.set('model', selection.model);
  return params.toString();
}

function writeUrlSelection(selection: ApiUsageUrlSelection) {
  const params = new URLSearchParams(window.location.search);
  for (const key of ['costType', 'range', 'month', 'date', 'from', 'to', 'model']) params.delete(key);
  params.set('costType', 'video');
  params.set('range', selection.range);
  if (selection.range === 'month') params.set('month', selection.month);
  if (selection.range === 'date') params.set('date', selection.date);
  if (selection.range === 'custom') {
    params.set('from', selection.from);
    params.set('to', selection.to);
  }
  if (selection.model !== 'all') params.set('model', selection.model);
  const query = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

function beijingToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function validMonth(value: string, maximum: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= maximum;
}

function validDate(value: string, maximum: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > maximum) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === (month ?? 1) - 1 && parsed.getUTCDate() === day;
}

function syncFreshnessBadge(status: AdminApiCostDashboard['sync']['items'][number]['status']) {
  if (status === 'fresh') return <Badge variant="success" dot>最新</Badge>;
  if (status === 'running') return <Badge variant="purple" dot>同步中</Badge>;
  if (status === 'stale') return <Badge variant="warning" dot>已过期</Badge>;
  if (status === 'failed') return <Badge variant="error">失败</Badge>;
  if (status === 'not-configured') return <Badge variant="default">未配置</Badge>;
  return <Badge variant="default">未同步</Badge>;
}

function syncKindLabel(kind: AdminApiCostDashboard['sync']['items'][number]['kind']) {
  if (kind === 'balance') return '账户余额';
  if (kind === 'bill') return '官方账单';
  return '资源包快照';
}

function combinedStatusVariant(state: AdminApiCostDashboard['combinedStatus']['matchState']): BadgeVariant {
  if (state === 'raw-matched') return 'success';
  if (state === 'adjusted-matched') return 'warning';
  if (state === 'residual') return 'error';
  return 'default';
}

function coverageVariant(status: AdminApiCostDashboard['combinedStatus']['coverageState']): BadgeVariant {
  if (status === 'complete') return 'success';
  if (status === 'partial' || status === 'stale') return 'warning';
  return 'default';
}

function coverageLabel(status: AdminApiCostDashboard['combinedStatus']['coverageState']) {
  return { complete: '覆盖完整', partial: '部分覆盖', stale: '数据已过期', unavailable: '暂无覆盖' }[status];
}

function billStatusLabel(status: AdminApiCostDashboard['summary']['billStatus']) {
  return { provisional: '出账中', final: '已定稿', unavailable: '账单不可用' }[status];
}

function matchStateBadge(state: AdminApiCostAttempt['reconciliationStatus']) {
  const variant = combinedStatusVariant(state);
  return <Badge variant={variant}>{matchStateLabel(state)}</Badge>;
}

function matchStateLabel(state: AdminApiCostAttempt['reconciliationStatus']) {
  return { 'cannot-reconcile': '暂不可对账', 'raw-matched': '原始采集一致', 'adjusted-matched': '经调整后对齐', residual: '仍有残差' }[state];
}

function paymentStatusBadge(status: AdminApiCostDashboard['settlement']['items'][number]['paymentStatus']) {
  const variants: Record<typeof status, BadgeVariant> = { paid: 'success', unpaid: 'error', partial: 'warning', zero: 'default', unknown: 'default' };
  const labels: Record<typeof status, string> = { paid: '已支付', unpaid: '未支付', partial: '部分支付', zero: '零元结算', unknown: '未知' };
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

function cny(value: string | null) {
  if (value === null) return '数据不可用';
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return '—';
  const integer = Number(match[2]).toLocaleString('zh-CN');
  return `${match[1]}¥${integer}.${(match[3] ?? '').padEnd(6, '0')}`;
}

function nullableCny(value: string | null) {
  return value === null ? '数据待补齐' : cny(value);
}

export function localEstimateHelper(
  value: string | null,
  completeness: EstimateCompleteness,
  availableText: string,
  unpricedAttempts: number | null,
  unavailableUsageAttempts: number | null,
) {
  if (value === null || completeness === 'unavailable') {
    return '本地覆盖不可用，无法形成列表价估算；未知金额未被当作 0';
  }
  if (completeness === 'partial') {
    return `当前金额仅为已知小计；${estimateCompletenessDescription(completeness, unpricedAttempts, unavailableUsageAttempts)}`;
  }
  return availableText;
}

function estimateCompletenessBadge(completeness: EstimateCompleteness) {
  const variant: BadgeVariant = completeness === 'complete' ? 'success' : completeness === 'partial' ? 'warning' : 'default';
  const label = completeness === 'complete' ? '完整估值' : completeness === 'partial' ? '部分估值' : '估值不可用';
  return <Badge variant={variant}>{label}</Badge>;
}

function estimateCompletenessDescription(
  completeness: EstimateCompleteness,
  unpricedAttempts: number | null,
  unavailableUsageAttempts: number | null,
) {
  if (completeness === 'complete') return '已知用量均已匹配有效价格。';
  if (completeness === 'unavailable') return '当前范围没有可用的本地估值数据。';
  const issues = [
    unpricedAttempts !== null && unpricedAttempts > 0 ? `正 Token 未计价 ${number(unpricedAttempts)} 次` : null,
    unavailableUsageAttempts !== null && unavailableUsageAttempts > 0 ? `NULL 用量缺失 ${number(unavailableUsageAttempts)} 次` : null,
  ].filter((item): item is string => item !== null);
  return `${issues.join('；') || '仍有记录未形成完整估值'}，已知金额不代表完整成本。`;
}

export function formatNoPackageProjection(summary: Pick<
  AdminApiCostDashboard['summary'],
  'noPackageProjectedDailyCostCny' | 'noPackageRunwayDays' | 'noPackageProjectionCoveredDays'
  | 'noPackageProjectionUnpricedRows' | 'noPackageProjectionUnpricedTokens' | 'noPackageProjectionStatus'
>, availableBalanceCny: string | null) {
  if (summary.noPackageProjectionStatus === 'unpriced') {
    return {
      value: '存在未计价用量',
      helper: `近 7 日有 ${number(summary.noPackageProjectionUnpricedRows)} 行、${number(summary.noPackageProjectionUnpricedTokens)} Token 无法归一单价，暂不预测无套餐日耗`,
    };
  }
  if (summary.noPackageProjectionStatus === 'unavailable' || summary.noPackageProjectedDailyCostCny === null) {
    return { value: '数据不足', helper: '近 7 日没有共同覆盖数据，暂不计算无套餐日耗和余额覆盖天数' };
  }
  const coverage = summary.noPackageProjectionStatus === 'partial'
    ? `近 7 日仅 ${summary.noPackageProjectionCoveredDays} 日可比，预测仅供参考；`
    : '近 7 日覆盖完整；';
  const helper = summary.noPackageRunwayDays === null
    ? Number(summary.noPackageProjectedDailyCostCny) === 0
      ? `${coverage}日均成本为 0，无法计算余额覆盖天数`
      : availableBalanceCny === null
        ? `${coverage}账户余额数据不可用，无法计算覆盖天数`
        : `${coverage}余额覆盖天数暂不可计算`
    : `${coverage}按全账户共享余额预计覆盖 ${summary.noPackageRunwayDays.toFixed(2)} 天`;
  return { value: `${cny(summary.noPackageProjectedDailyCostCny)}/天`, helper };
}

function listPriceOffsetLabel(settlement: AdminApiCostDashboard['books']['settlement']) {
  if (settlement.listPriceOffsetStatus === 'unpriced') return '存在未计价用量，暂不可计算';
  if (settlement.listPriceOffsetStatus === 'unavailable' || settlement.listPriceOffsetValueCny === null) return '数据不可用';
  return cny(settlement.listPriceOffsetValueCny);
}

function varianceCny(value: string | null) {
  return value === null ? '未独立计算（保留在残差）' : cny(value);
}

export function formatReconciliationVariancePair(rate: string | null, rounding: string | null) {
  return `${varianceCny(rate)} / ${varianceCny(rounding)}`;
}

function isNonZeroCny(value: string | null) {
  return value !== null && value !== '0.000000';
}

function cnyPerMillion(value: string) {
  return `${cny(value)} / 百万 Token`;
}

function signedNumber(value: number) {
  return `${value > 0 ? '+' : ''}${number(value)}`;
}

export function formatBookToken(value: number | null, signed = false) {
  if (value === null) return '数据不可用';
  return `${signed ? signedNumber(value) : number(value)} Token`;
}

function isNonZeroNumber(value: number | null) {
  return value !== null && value !== 0;
}

function nullableNumber(value: number | null) {
  return value === null ? '数据不可用' : number(value);
}

function percent(value: number | null) {
  return value === null ? '不可计算' : `${value.toFixed(2)}%`;
}

function shortId(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function billableBasisLabel(value: AdminApiCostAttempt['billableBasis']) {
  if (value === 'completion_tokens') return 'usage.completion_tokens';
  if (value === 'raw_units_legacy') return '本地旧 raw_units 推算';
  return '供应商未返回';
}

function inputClassLabel(value: AdminApiCostAttempt['inputClass']) {
  return { 'without-video': '不含视频输入', 'with-video': '包含视频输入', unknown: '输入档未知' }[value];
}

function evidenceOriginLabel(value: AdminApiCostAttempt['usageEvidenceOrigin']) {
  return { 'provider-reported': '供应商回执', 'legacy-raw': '本地旧记录推算', 'official-bill-inferred': '账单匹配推断', unavailable: '未取得供应商用量' }[value];
}

function pricingRuleStatusLabel(value: AdminApiCostAttempt['pricingRuleStatus']) {
  return { priced: '已匹配价格规则', 'rule-missing': '未匹配价格规则', unsupported: '平台不支持' }[value];
}

function confidenceLabel(value: AdminApiCostAttempt['attributionConfidence']) {
  return { direct: '直接证据', high: '高可信', medium: '中可信', low: '低可信', unallocated: '未归因' }[value];
}

function evidenceSideLabel(value: AdminApiCostReconciliationDetail['evidence'][number]['side']) {
  return {
    local: '本地用量',
    official: '官方账单',
    adjustment: '推断调整',
    'zero-cost-candidate': '零成本候选',
  }[value];
}

function evidenceSideVariant(value: AdminApiCostReconciliationDetail['evidence'][number]['side']): BadgeVariant {
  if (value === 'local') return 'blue';
  if (value === 'official') return 'purple';
  return 'warning';
}

function zeroCostCandidateEvidenceSummary(evidence: Record<string, unknown>) {
  const caseStatus = evidence.caseStatus === 'approved'
    ? '已批准'
    : evidence.caseStatus === 'open'
      ? '待终账'
      : String(evidence.caseStatus ?? '未知');
  const providerEvidence = evidence.evidenceType === 'manual-audit'
    ? '管理员已核实供应商未创建任务'
    : `供应商 ${String(evidence.providerHttpStatus ?? '4xx')} 确定性拒绝创建`;
  return `${caseStatus} · ${providerEvidence} · 仅用于账户账单桶级审计`;
}

function billLineTypeLabel(value: AdminApiCostDashboard['settlement']['items'][number]['billLineType']) {
  return { usage: '用量', 'package-purchase': '资源包购买', refund: '退款', adjustment: '账单调整', other: '其他' }[value];
}

function acquisitionLinkLabel(value: AdminApiCostDashboard['settlement']['items'][number]['acquisitionLinkStatus']) {
  return { linked: '已关联购置', missing: '缺购置成本', 'not-applicable': '无需关联' }[value];
}

function allocationStatusLabel(value: AdminApiCostDashboard['books']['settlement']['allocationStatus']) {
  return { complete: '完整', partial: '部分数据待补齐', unavailable: '无法计算' }[value];
}

function timeAttributionStatusLabel(value: AdminApiCostDashboard['books']['settlement']['timeAttributionStatus']) {
  return { complete: '完整', partial: '部分日期无法精确归属', unavailable: '无法归属' }[value];
}

function resolutionBandLabel(value: AdminApiCostDashboard['pricingRules'][number]['resolution']) {
  return { '480p-720p': '480P / 720P', '1080p': '1080P', '4k': '4K', unknown: '未知' }[value];
}

function periodLabel(start: string, end: string) {
  return start === end ? start : `${start} 至 ${end}`;
}

function grainLabel(value: AdminApiCostDashboard['selection']['grain']) {
  return { month: '按月', day: '按日', bucket: '按模型/计价桶' }[value];
}

function trendPeriodLabel(value: string, grain: AdminApiCostDashboard['selection']['grain']) {
  if (grain === 'month') return value.slice(0, 7);
  if (grain === 'day') return value.slice(5);
  return value;
}

export function buildApiCostChartData(
  daily: AdminApiCostDashboard['daily'],
  grain: AdminApiCostDashboard['selection']['grain'],
) {
  return daily.map(row => ({
    period: trendPeriodLabel(row.day, grain),
    本地列表价估算: row.localEstimatedCostCny === null ? null : Number(row.localEstimatedCostCny),
    官方用量列表价折算: row.officialListEquivalentCostCny === null ? null : Number(row.officialListEquivalentCostCny),
    用量账单应付: row.officialPayableAmountCny === null ? null : Number(row.officialPayableAmountCny),
  }));
}

function formatTrendTooltip(value: unknown) {
  if (value === null || value === undefined) return '暂无覆盖';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? cny(parsed.toFixed(6)) : '暂无覆盖';
}
