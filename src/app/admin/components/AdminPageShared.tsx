import {
  BarChart3,
  Check,
  Coins,
  Search,
  SendHorizontal,
  X
} from 'lucide-react';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  type AdminAuditLog,
  type AdminCreditLedgerEntry,
  type AdminGenerationJob,
  type AdminInvoiceRequest,
  type AdminOrder,
  type AdminPlan,
  type AdminPlanFeature,
  type AdminTicket,
  type AdminUser,
  type CreditBucket,
  type PlanRecommendation,
  type PlanIconKey,
  type TicketMessage
} from '../../data/admin';
import { formatRetryAfterMs,paymentAttemptStatusLabel,refundAttemptStatusLabel } from '../../data/paymentState';
import { generationJobDisplayStatus,generationJobReviewMessage } from '../../data/generationJobState';
import { getPlanIconGradientClass,getPlanIconGradientForPlan,getPlanIconOption,PLAN_ICON_OPTIONS } from '../../data/planIcons';
import { createClientId } from '../../utils/clientId';
import { ACQUISITION_SOURCE_LABELS } from '@lindyson/api-contracts';
import { Badge,Button,Card,Select } from '../../ui';
import { centsToYuan,formatCnyFromCents,yuanToCents } from '../../utils/currency';
import type { ExactCursorPagination,PagePosition } from '../../api/cursor';
import { CursorPagination } from '../../components/CursorPagination';
import { PaginationFooter } from '../../components/PaginationFooter';

import type { ConfirmState,OrderTimeRange } from '../types';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'purple' | 'pink' | 'orange' | 'blue';

export const ORDER_TIME_RANGE_TABS: Array<{ id: OrderTimeRange; label: string }> = [
  { id: 'today', label: '本日' },
  { id: 'seven-days', label: '近七日' },
  { id: 'month', label: '本月' },
  { id: 'all', label: '全部' },
];

export const ORDER_TIME_RANGE_LABEL: Record<OrderTimeRange, string> = {
  today: '本日',
  'seven-days': '近七日',
  month: '本月',
  all: '全部',
};

export interface AdminColumn<T> {
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
}

export const STATUS_MAP: Record<string, { label: string; variant: BadgeVariant; dot?: boolean }> = {
  active: { label: '启用中', variant: 'success', dot: true },
  disabled: { label: '已停用', variant: 'default' },
  draft: { label: '草稿', variant: 'purple' },
  paid: { label: '已支付', variant: 'success', dot: true },
  pending: { label: '待处理', variant: 'warning', dot: true },
  refunded: { label: '已退款', variant: 'blue' },
  unissued: { label: '未开票', variant: 'warning' },
  issued: { label: '已开票', variant: 'success' },
  failed: { label: '失败', variant: 'error' },
  frozen: { label: '已冻结', variant: 'error' },
  trial: { label: '试用中', variant: 'purple' },
  open: { label: '待响应', variant: 'warning', dot: true },
  resolved: { label: '已解决', variant: 'success' },
  normal: { label: '正常', variant: 'success', dot: true },
  warning: { label: '需关注', variant: 'warning', dot: true },
  error: { label: '异常', variant: 'error' },
  healthy: { label: '未触发预警', variant: 'success', dot: true },
  'low-balance': { label: '余额偏低', variant: 'error', dot: true },
  'trend-warning': { label: '趋势预警', variant: 'warning', dot: true },
  expiring: { label: '即将到期', variant: 'orange', dot: true },
  earn: { label: '获得', variant: 'success' },
  hold: { label: '预扣', variant: 'purple' },
  spend: { label: '消耗', variant: 'error' },
  refund: { label: '退回', variant: 'blue' },
  adjust: { label: '调整', variant: 'purple' },
  void: { label: '冲销', variant: 'orange' },
  none: { label: '未到账', variant: 'default' },
  held: { label: '已预扣', variant: 'purple', dot: true },
  settled: { label: '已结算', variant: 'success', dot: true },
  reversed: { label: '已冲销', variant: 'orange' },
  queued: { label: '分析中', variant: 'purple', dot: true },
  processing: { label: '生成中', variant: 'purple', dot: true },
  'submission-unknown': { label: '提交异常，待核验', variant: 'warning', dot: true },
  'manual-review': { label: '待人工核验', variant: 'warning', dot: true },
  completed: { label: '已完成', variant: 'success' },
  canceled: { label: '已取消', variant: 'blue' },
  'insufficient-credits': { label: '余额不足', variant: 'warning' },
  'provider-failed': { label: '供应商失败', variant: 'error' },
  'content-policy': { label: '内容违规', variant: 'orange' },
  'user-canceled': { label: '历史用户取消', variant: 'blue' },
  'system-timeout': { label: '系统超时', variant: 'warning' },
  high: { label: '高', variant: 'error' },
  medium: { label: '中', variant: 'warning' },
  low: { label: '低', variant: 'blue' },
};

export const money = formatCnyFromCents;
export const number = (value: number) => value.toLocaleString();
export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseAdminTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value.replace(' ', 'T')).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function startOfAdminDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function isSameAdminDay(value: string | undefined | null, basis: Date) {
  const timestamp = parseAdminTimestamp(value);
  if (timestamp === null) return false;
  return startOfAdminDay(new Date(timestamp)) === startOfAdminDay(basis);
}

export function isSameAdminMonth(value: string | undefined | null, basis: Date) {
  const timestamp = parseAdminTimestamp(value);
  if (timestamp === null) return false;
  const date = new Date(timestamp);
  return date.getFullYear() === basis.getFullYear() && date.getMonth() === basis.getMonth();
}

export function isWithinAdminDays(value: string | undefined | null, basis: Date, days: number) {
  const timestamp = parseAdminTimestamp(value);
  if (timestamp === null) return false;
  const diff = startOfAdminDay(basis) - startOfAdminDay(new Date(timestamp));
  return diff >= 0 && diff <= (days - 1) * DAY_MS;
}

export function isInAdminTimeRange(value: string | undefined | null, basis: Date, range: OrderTimeRange) {
  if (range === 'all') return true;
  if (range === 'today') return isSameAdminDay(value, basis);
  if (range === 'seven-days') return isWithinAdminDays(value, basis, 7);
  return isSameAdminMonth(value, basis);
}

export function statusBadge(status: string) {
  const option = STATUS_MAP[status] ?? { label: status, variant: 'default' as BadgeVariant };
  return <Badge variant={option.variant} dot={option.dot}>{option.label}</Badge>;
}

export function planTypeBadge(kind: AdminPlan['kind']) {
  return kind === 'addon'
    ? <Badge variant="blue">加购包</Badge>
    : <Badge variant="purple">主套餐</Badge>;
}

export function planPriceLabel(plan: AdminPlan) {
  if (plan.kind === 'addon') return `${money(plan.monthlyPrice)} 一次性`;
  return `${money(plan.monthlyPrice)}/月 · ${money(plan.yearlyPrice)}/年`;
}

export function planCreditLabel(plan: AdminPlan) {
  return plan.kind === 'addon'
    ? `${number(plan.credits)} 补充积分`
    : `${number(plan.credits)} 周期积分`;
}

export function recommendationLabel(value: PlanRecommendation) {
  if (value === 'popular') return '最受欢迎';
  if (value === 'enterprise') return '企业首选';
  return '不设置';
}

export type AdminPageWidth = 'standard' | 'dashboard' | 'cost' | 'full';

export function PageShell({ title, subtitle, eyebrow = 'OPERATIONS', action, width = 'standard', children }: {
  title: string;
  subtitle: string;
  eyebrow?: string;
  action?: ReactNode;
  width?: AdminPageWidth;
  children: ReactNode;
}) {
  const widthClass = {
    standard: 'max-w-[1440px]',
    dashboard: 'max-w-[1600px]',
    cost: 'max-w-[1760px]',
    full: 'max-w-none',
  }[width];

  return (
    <div data-ui="admin-page" data-width={width} className="min-w-0 p-4 sm:p-6 lg:p-7">
      <div className={`mx-auto w-full min-w-0 space-y-5 sm:space-y-6 ${widthClass}`}>
        <div data-ui="admin-page-header" className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            {eyebrow && <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300/90">{eyebrow}</p>}
            <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.03em] text-[var(--admin-text-primary)] sm:text-[1.875rem]">{title}</h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[var(--admin-text-secondary)]">{subtitle}</p>
          </div>
          {action && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{action}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function MetricCard({ icon: Icon, label, value, helper, action, tone = 'purple', density = 'default' }: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  helper: string;
  action?: ReactNode;
  tone?: 'purple' | 'blue' | 'pink' | 'orange' | 'green' | 'neutral';
  density?: 'default' | 'compact';
}) {
  if (density === 'compact') {
    return (
      <Card variant="raised" data-admin-ui="metric" data-tone={tone} data-density="compact" className="h-full p-4">
        <div className="flex items-start gap-3">
          <div data-ui="admin-metric-icon" className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--admin-text-secondary)]">{label}</p>
            <p className="mt-1.5 text-[1.35rem] font-extrabold leading-none tracking-[-0.025em] text-[var(--admin-text-primary)]">{value}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--admin-text-muted)]">{helper}</p>
        {action && <div className="mt-3">{action}</div>}
      </Card>
    );
  }

  return (
    <Card variant="raised" data-admin-ui="metric" data-tone={tone} className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div data-ui="admin-metric-icon" className="flex h-10 w-10 items-center justify-center rounded-xl border">
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <p className="mt-4 text-[1.625rem] font-extrabold leading-none tracking-[-0.025em] text-[var(--admin-text-primary)]">{value}</p>
      <p className="mt-2 text-xs font-medium text-[var(--admin-text-secondary)]">{label}</p>
      <p className="mt-3 text-xs leading-5 text-[var(--admin-text-muted)]">{helper}</p>
      {action && <div className="mt-3">{action}</div>}
    </Card>
  );
}

export function SearchFilter({ search, onSearch, placeholder, children }: {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div data-ui="admin-filter-bar" className="flex flex-wrap items-center justify-between gap-3">
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={event => onSearch(event.target.value)}
          placeholder={placeholder ?? '搜索...'}
          aria-label={placeholder ?? '搜索'}
          data-ui="control"
          className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder-gray-500 outline-none transition-[background-color,border-color,color] duration-[180ms] focus:border-purple-500/50"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function FilterChips<T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label?: string;
}) {
  return (
    <div data-ui="admin-filter-chips" role="group" aria-label={label ?? '筛选条件'} className="flex flex-wrap items-center gap-2">
      {label && <span className="text-xs text-gray-500">{label}</span>}
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            data-state={active ? 'active' : 'inactive'}
            onClick={() => onChange(option.value)}
            className={`h-9 rounded-xl border px-3 text-xs font-semibold transition-[background-color,border-color,color,box-shadow] duration-[180ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
              active
                ? 'border-violet-400/25 bg-violet-500/[0.12] text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]'
                : 'border border-white/10 bg-white/5 text-gray-400 hover:border-purple-500/40 hover:bg-white/10 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SelectFilter<T extends string>({ value, onChange, options, label, disabled = false, error }: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label?: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      {label && <span className="mt-[10px] flex-shrink-0 text-xs leading-4 text-gray-400">{label}</span>}
      <Select
        value={value}
        options={options}
        onValueChange={onChange}
        size="filter"
        maxVisibleOptions={6}
        dropdownMinWidth={160}
        containerClassName="min-w-[96px]"
        className="min-w-[96px] font-medium text-gray-200"
        disabled={disabled}
        error={error}
        aria-label={label ?? '选择筛选条件'}
      />
    </div>
  );
}

export function AdminDataTable<T extends { id: string }>({
  items,
  columns,
  gridTemplate,
  pageSize = 8,
  paginate = true,
  onRowClick,
  resetKey,
  serverPagination,
  serverLoading = false,
  onServerNavigate,
  paginationLabel = '分页导航',
  minTableWidth = 960,
  emptyLabel = '暂无符合条件的记录',
}: {
  items: T[];
  columns: Array<AdminColumn<T>>;
  gridTemplate: string;
  pageSize?: number;
  paginate?: boolean;
  onRowClick?: (item: T) => void;
  resetKey?: string;
  serverPagination?: ExactCursorPagination;
  serverLoading?: boolean;
  onServerNavigate?: (position: PagePosition) => void;
  paginationLabel?: string;
  minTableWidth?: number;
  emptyLabel?: string;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const localItemsIdentity = JSON.stringify(items.map(item => item.id));
  // 服务端首屏拿到精准总数后再显示 Dock；翻页加载期间由上层保留旧页元数据与内容。
  const serverMode = Boolean(onServerNavigate);
  const visible = serverMode || !paginate
    ? items
    : items.slice((safePage - 1) * pageSize, safePage * pageSize);
  const localPagination: ExactCursorPagination = {
    limit: pageSize,
    position: 'first',
    hasPrevious: safePage > 1,
    hasNext: safePage < totalPages,
    previousCursor: safePage > 1 ? String(safePage - 1) : null,
    nextCursor: safePage < totalPages ? String(safePage + 1) : null,
    currentPage: items.length === 0 ? 0 : safePage,
    totalPages: items.length === 0 ? 0 : totalPages,
    totalItems: items.length,
    snapshotCursor: `admin-local:${pageSize}:${items.length}`,
  };
  const pagination = serverMode ? serverPagination : localPagination;
  const totalItems = pagination?.totalItems ?? items.length;

  const navigateLocalPage = (position: PagePosition) => {
    if (position === 'first') setPage(1);
    else if (position === 'previous') setPage(current => Math.max(1, current - 1));
    else if (position === 'next') setPage(current => Math.min(totalPages, current + 1));
    else setPage(totalPages);
  };

  useEffect(() => {
    setPage(1);
  }, [localItemsIdentity]);

  useEffect(() => {
    if (resetKey !== undefined) setPage(1);
  }, [resetKey]);

  const tableMinWidth = `${Math.max(720, minTableWidth)}px`;

  return (
    <Card data-admin-ui="table" role="table" aria-rowcount={totalItems + 1} aria-busy={serverMode && serverLoading} className="overflow-hidden">
      <div data-ui="admin-table-scroll" className="overflow-x-auto" tabIndex={0} aria-label="数据表格，可横向滚动">
        <div
          role="row"
          className="grid gap-4 border-b border-white/10 px-4 py-3 text-xs text-gray-500"
          style={{ gridTemplateColumns: gridTemplate, minWidth: tableMinWidth }}
        >
          {columns.map(column => (
            <div role="columnheader" key={column.header} className={`min-h-7 flex min-w-0 items-center ${column.className ?? ''}`}>
              {column.header}
            </div>
          ))}
        </div>
        <div className="divide-y divide-white/10">
          {visible.map(item => (
            <div
              key={item.id}
              role="row"
              className={`grid w-full gap-4 px-4 py-3 text-left text-sm transition-colors duration-[180ms] ${onRowClick ? 'hover:bg-white/5' : ''}`}
              style={{ gridTemplateColumns: gridTemplate, minWidth: tableMinWidth }}
            >
              {columns.map((column, columnIndex) => (
                <div role="cell" key={column.header} className={`min-h-8 flex min-w-0 items-center text-gray-300 ${column.className ?? ''}`}>
                  {columnIndex === 0 && onRowClick ? (
                    <button
                      type="button"
                      onClick={() => onRowClick(item)}
                      className="min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                      aria-label={`查看${column.header}详情：${item.id}`}
                    >
                      {column.render(item)}
                    </button>
                  ) : column.render(item)}
                </div>
              ))}
            </div>
          ))}
          {visible.length === 0 && (
            <div data-ui="admin-empty-state" className="flex min-h-28 items-center justify-center px-4 py-8 text-center text-sm text-[var(--admin-text-muted)]" style={{ minWidth: tableMinWidth }}>
              {serverLoading ? '正在读取服务端数据…' : emptyLabel}
            </div>
          )}
        </div>
      </div>
      <PaginationFooter data-ui="admin-table-pagination" count={visible.length} totalItems={serverMode ? totalItems : items.length} totalPages={serverMode || paginate ? pagination?.totalPages : undefined} className="border-t border-white/10 px-4 py-3">
        {(serverMode || paginate) && pagination && totalItems > 0 ? (
          <CursorPagination
            pagination={pagination}
            loading={serverMode && serverLoading}
            empty={totalItems === 0}
            onNavigate={serverMode ? position => onServerNavigate?.(position) : navigateLocalPage}
            label={paginationLabel}
          />
        ) : null}
      </PaginationFooter>
    </Card>
  );
}

export function DetailGrid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div data-ui="admin-detail-grid" className="rounded-2xl border border-white/10 bg-white/5 p-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 py-2 text-sm">
          <span className="text-gray-500">{label}</span>
          <span className="text-right font-semibold text-white">{value}</span>
        </div>
      ))}
    </div>
  );
}


export function Stack({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold text-white">{title}</div>
      {subtitle && <div className="mt-1 truncate text-xs text-gray-500">{subtitle}</div>}
    </div>
  );
}

export function creditBucketLabel(bucket: CreditBucket) {
  const labels: Record<CreditBucket, string> = {
    main: '主套餐',
    addon: '加购包',
    mixed: '混合',
    system: '系统',
  };

  return labels[bucket] ?? bucket;
}

export function RelationStack({ entry }: { entry: AdminCreditLedgerEntry }) {
  const relations = [
    entry.relatedOrderId ? `订单 ${entry.relatedOrderId}` : '',
    entry.relatedJobId ? `任务 ${entry.relatedJobId}` : '',
    entry.relatedAssetId ? `资产 ${entry.relatedAssetId}` : '',
  ].filter(Boolean);

  return relations.length > 0 ? <Stack title={relations[0]} subtitle={relations.slice(1).join(' · ')} /> : <span className="text-gray-500">-</span>;
}

export function formatFeatures(features: AdminPlanFeature[]) {
  return features.map(feature => `${feature.enabled ? '✓' : '✗'} ${feature.text}`).join('\n');
}

export function parseFeatures(value: string): AdminPlanFeature[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const disabled = /^(✗|x|X|-)\s*/.test(line);
      const text = line.replace(/^(✓|\+|✗|x|X|-)\s*/, '').trim();
      return { text, enabled: !disabled };
    })
    .filter(feature => feature.text.length > 0);
}

export function buildDefaultPlan(kind: AdminPlan['kind']): AdminPlan {
  const planId = createClientId('plan');
  const code = kind === 'addon' ? planId.replace(/^plan-/, 'addon-') : planId;
  return {
    id: planId,
    name: kind === 'addon' ? '新加购包' : '新套餐',
    nameEn: kind === 'addon' ? 'New Add-on' : 'New Plan',
    code,
    kind,
    billing: kind === 'addon' ? 'one-time' : 'both',
    description: kind === 'addon' ? '一次性补充积分，不改变套餐周期或重置日期' : '适合新的用户分层',
    monthlyPrice: kind === 'addon' ? 4900 : 1900,
    yearlyPrice: kind === 'addon' ? 0 : 19000,
    credits: kind === 'addon' ? 10000 : 5000,
    assetRetentionDays: 0,
    portraitEntitlements: {
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    },
    storage: kind === 'addon' ? '不增加' : '50GB',
    tiktokAccounts: kind === 'addon' ? '不增加' : '3',
    features: kind === 'addon'
      ? []
      : [
          { text: 'AI 视频生成', enabled: true },
          { text: 'AI 图片生成', enabled: true },
          { text: '数字资产管理', enabled: true },
        ],
    recommendation: null,
    iconKey: kind === 'main' ? 'sparkles' : null,
    ctaLabel: kind === 'addon' ? '购买加购包' : '升级套餐',
    status: 'draft',
    landingVisible: false,
    subscribers: 0,
    revenue: 0,
    updatedAt: '2026-06-19 10:00',
  };
}

export function PlanIconPreview({ plan, className = 'h-9 w-9' }: { plan: AdminPlan; className?: string }) {
  const option = plan.kind === 'main' ? getPlanIconOption(plan.iconKey) : null;
  const Icon = option?.icon ?? Coins;
  const iconKey = plan.kind === 'main' ? option?.key ?? 'sparkles' : 'coins';

  return (
    <span
      aria-label={`${option?.label ?? '金币'}图标`}
      data-plan-icon-key={iconKey}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${getPlanIconGradientForPlan(plan)} text-white ${className}`}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function PlanDetail({ plan }: { plan: AdminPlan }) {
  const rows: Array<[string, ReactNode]> = plan.kind === 'addon'
    ? [
        ['套餐名称', plan.name],
        ['英文名', plan.nameEn],
        ['套餐代码', plan.code],
        ['类型', planTypeBadge(plan.kind)],
        ['简介', plan.description],
        ['一次性价格', money(plan.monthlyPrice)],
        ['补充积分', number(plan.credits)],
        ['真人演员库', '不增加额度'],
        ['CTA 文案', plan.ctaLabel],
        ['首页展示', '不展示'],
        ['订阅用户', number(plan.subscribers)],
        ['累计收入', money(plan.revenue)],
        ['状态', statusBadge(plan.status)],
        ['更新时间', plan.updatedAt],
      ]
    : [
        ['套餐名称', plan.name],
        ['英文名', plan.nameEn],
        ['套餐代码', plan.code],
        ['类型', planTypeBadge(plan.kind)],
        ['简介', plan.description],
        ['月付价格', money(plan.monthlyPrice)],
        ['年付价格', money(plan.yearlyPrice)],
        ['周期积分', number(plan.credits)],
        ['AI 生成素材保留', plan.assetRetentionDays === 0 ? '永久保留' : `${plan.assetRetentionDays} 天`],
        ['每日扫描时间', '北京时间 03:00'],
        ['真人演员库', plan.portraitEntitlements.enabled ? '已启用' : '未启用'],
        ['真人档案上限', plan.portraitEntitlements.enabled
          ? plan.portraitEntitlements.profileLimit === null
            ? '不限'
            : `${number(plan.portraitEntitlements.profileLimit)} 人`
          : '0 人'],
        ['同时激活上限', `${number(plan.portraitEntitlements.activeLimit)} 人`],
        ['每名演员图片', `${number(plan.portraitEntitlements.assetsPerActor)} 张`],
        ['存储空间', plan.storage],
        ['TikTok 账号', plan.tiktokAccounts],
        ['推荐标识', recommendationLabel(plan.recommendation)],
        ['套餐图标', (
          <span className="inline-flex items-center gap-2">
            <PlanIconPreview plan={plan} />
            <span>{getPlanIconOption(plan.iconKey).label}</span>
          </span>
        )],
        ['CTA 文案', plan.ctaLabel],
        ['首页展示', plan.landingVisible ? '展示' : '隐藏'],
        ['订阅用户', number(plan.subscribers)],
        ['累计收入', money(plan.revenue)],
        ['状态', statusBadge(plan.status)],
        ['更新时间', plan.updatedAt],
      ];

  return (
    <div className="space-y-4">
      <DetailGrid rows={rows} />
      {plan.kind === 'main' && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="mb-3 text-sm font-semibold text-white">用户端功能权益</p>
          <div className="space-y-2">
            {plan.features.map(feature => (
              <div key={feature.text} className="flex items-center gap-2 text-sm">
                {feature.enabled ? <Check className="w-4 h-4 text-green-400" /> : <X className="w-4 h-4 text-gray-600" />}
                <span className={feature.enabled ? 'text-gray-300' : 'text-gray-600'}>{feature.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlanEditForm({ plan, onSave }: { plan?: AdminPlan; onSave: (plan: AdminPlan) => void | Promise<void> }) {
  const [kind, setKind] = useState<AdminPlan['kind']>(plan?.kind ?? 'main');
  const basePlan = plan ?? buildDefaultPlan(kind);
  const [name, setName] = useState(basePlan.name);
  const [nameEn, setNameEn] = useState(basePlan.nameEn);
  const [code, setCode] = useState(basePlan.code);
  const [description, setDescription] = useState(basePlan.description);
  const [monthlyPriceYuan, setMonthlyPriceYuan] = useState(String(centsToYuan(basePlan.monthlyPrice)));
  const [yearlyPriceYuan, setYearlyPriceYuan] = useState(String(centsToYuan(basePlan.yearlyPrice)));
  const [credits, setCredits] = useState(String(basePlan.credits));
  const [assetRetentionDays, setAssetRetentionDays] = useState(String(basePlan.assetRetentionDays));
  const [portraitEnabled, setPortraitEnabled] = useState(basePlan.portraitEntitlements.enabled);
  const [portraitProfileUnlimited, setPortraitProfileUnlimited] = useState(
    basePlan.portraitEntitlements.enabled && basePlan.portraitEntitlements.profileLimit === null,
  );
  const [portraitProfileLimit, setPortraitProfileLimit] = useState(String(
    basePlan.portraitEntitlements.profileLimit ?? 1,
  ));
  const [portraitActiveLimit, setPortraitActiveLimit] = useState(String(
    basePlan.portraitEntitlements.activeLimit || 1,
  ));
  const [portraitAssetsPerActor, setPortraitAssetsPerActor] = useState<'1' | '2'>(
    basePlan.portraitEntitlements.assetsPerActor === 2 ? '2' : '1',
  );
  const [storage, setStorage] = useState(basePlan.storage);
  const [tiktokAccounts, setTiktokAccounts] = useState(basePlan.tiktokAccounts);
  const [featuresText, setFeaturesText] = useState(formatFeatures(basePlan.features));
  const [recommendation, setRecommendation] = useState<PlanRecommendation>(basePlan.recommendation);
  const [iconKey, setIconKey] = useState<PlanIconKey | null>(basePlan.iconKey);
  const [status, setStatus] = useState<AdminPlan['status']>(basePlan.status);
  const [landingVisible, setLandingVisible] = useState(basePlan.landingVisible);
  const [ctaLabel, setCtaLabel] = useState(basePlan.ctaLabel);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const updateKind = (nextKind: AdminPlan['kind']) => {
    if (plan) return;
    const nextPlan = buildDefaultPlan(nextKind);
    setKind(nextKind);
    setName(nextPlan.name);
    setNameEn(nextPlan.nameEn);
    setCode(nextPlan.code);
    setDescription(nextPlan.description);
    setMonthlyPriceYuan(String(centsToYuan(nextPlan.monthlyPrice)));
    setYearlyPriceYuan(String(centsToYuan(nextPlan.yearlyPrice)));
    setCredits(String(nextPlan.credits));
    setAssetRetentionDays(String(nextPlan.assetRetentionDays));
    setPortraitEnabled(nextPlan.portraitEntitlements.enabled);
    setPortraitProfileUnlimited(
      nextPlan.portraitEntitlements.enabled && nextPlan.portraitEntitlements.profileLimit === null,
    );
    setPortraitProfileLimit(String(nextPlan.portraitEntitlements.profileLimit ?? 1));
    setPortraitActiveLimit(String(nextPlan.portraitEntitlements.activeLimit || 1));
    setPortraitAssetsPerActor(nextPlan.portraitEntitlements.assetsPerActor === 2 ? '2' : '1');
    setStorage(nextPlan.storage);
    setTiktokAccounts(nextPlan.tiktokAccounts);
    setFeaturesText(formatFeatures(nextPlan.features));
    setRecommendation(null);
    setIconKey(nextPlan.iconKey);
    setStatus(nextPlan.status);
    setLandingVisible(nextPlan.landingVisible);
    setCtaLabel(nextPlan.ctaLabel);
    setError('');
  };

  const save = async () => {
    if (saving) return;
    const safeKind = plan?.kind ?? kind;
    const isAddon = safeKind === 'addon';
    const trimmedName = name.trim();
    const trimmedCode = code.trim();
    const trimmedDescription = description.trim();
    const trimmedCta = ctaLabel.trim();
    const parsedMonthlyPriceYuan = parseFiniteNumberInput(monthlyPriceYuan);
    const parsedYearlyPriceYuan = parseFiniteNumberInput(yearlyPriceYuan);
    const parsedCredits = parseIntegerInput(credits);
    const parsedAssetRetentionDays = parseIntegerInput(assetRetentionDays);
    const parsedPortraitProfileLimit = parseIntegerInput(portraitProfileLimit);
    const parsedPortraitActiveLimit = parseIntegerInput(portraitActiveLimit);
    const parsedPortraitAssetsPerActor = Number(portraitAssetsPerActor);
    const nextError = validatePlanEditForm({
      name: trimmedName,
      code: trimmedCode,
      description: trimmedDescription,
      ctaLabel: trimmedCta,
      monthlyPriceYuan: parsedMonthlyPriceYuan,
      yearlyPriceYuan: parsedYearlyPriceYuan,
      credits: parsedCredits,
      assetRetentionDays: parsedAssetRetentionDays,
      kind: safeKind,
      portraitEnabled,
      portraitProfileUnlimited,
      portraitProfileLimit: parsedPortraitProfileLimit,
      portraitActiveLimit: parsedPortraitActiveLimit,
      portraitAssetsPerActor: parsedPortraitAssetsPerActor,
    });

    if (nextError) {
      setError(nextError);
      return;
    }

    const monthlyPrice = yuanToCents(parsedMonthlyPriceYuan!);
    const yearlyPrice = isAddon ? 0 : yuanToCents(parsedYearlyPriceYuan!);
    const safeCredits = parsedCredits!;

    const nextPlan: AdminPlan = {
      ...(plan ?? buildDefaultPlan(safeKind)),
      name: trimmedName,
      nameEn: nameEn.trim(),
      code: trimmedCode,
      kind: safeKind,
      billing: isAddon ? 'one-time' : 'both',
      description: trimmedDescription,
      monthlyPrice,
      yearlyPrice,
      credits: safeCredits,
      assetRetentionDays: isAddon ? 0 : parsedAssetRetentionDays!,
      portraitEntitlements: isAddon || !portraitEnabled
        ? {
            enabled: false,
            profileLimit: 0,
            activeLimit: 0,
            assetsPerActor: 0,
          }
        : {
            enabled: true,
            profileLimit: portraitProfileUnlimited ? null : parsedPortraitProfileLimit!,
            activeLimit: parsedPortraitActiveLimit!,
            assetsPerActor: parsedPortraitAssetsPerActor,
          },
      storage: isAddon ? '不增加' : storage.trim(),
      tiktokAccounts: isAddon ? '不增加' : tiktokAccounts.trim(),
      features: isAddon ? [] : parseFeatures(featuresText),
      recommendation: isAddon ? null : recommendation,
      iconKey: isAddon ? null : iconKey ?? 'sparkles',
      status,
      landingVisible: isAddon ? false : landingVisible,
      ctaLabel: trimmedCta,
    };

    setError('');
    setSaving(true);
    try {
      await onSave(nextPlan);
    } finally {
      setSaving(false);
    }
  };

  const currentKind = plan?.kind ?? kind;

  return (
    <div className="space-y-5">
      {!plan && (
        <SegmentedField
          label="套餐类型"
          value={kind}
          onChange={updateKind}
          options={[
            { value: 'main', label: '主套餐' },
            { value: 'addon', label: '加购包' },
          ]}
        />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <AdminInput label="套餐名称" value={name} onChange={setName} />
        <AdminInput
          label="套餐代码"
          value={code}
          onChange={setCode}
          disabled={plan?.code.toLowerCase() === 'free'}
        />
        <AdminInput label="英文名" value={nameEn} onChange={setNameEn} />
      </div>

      <AdminTextarea label="简介" value={description} onChange={setDescription} rows={3} />

      {currentKind === 'addon' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <AdminNumberInput label="一次性价格（元）" value={monthlyPriceYuan} onChange={setMonthlyPriceYuan} />
          <AdminNumberInput label="补充积分" value={credits} onChange={setCredits} />
          <AdminInput label="CTA 文案" value={ctaLabel} onChange={setCtaLabel} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <AdminNumberInput label="月付价格（元）" value={monthlyPriceYuan} onChange={setMonthlyPriceYuan} />
            <AdminNumberInput label="年付总价（元）" value={yearlyPriceYuan} onChange={setYearlyPriceYuan} />
            <AdminNumberInput label="周期积分" value={credits} onChange={setCredits} />
            <AdminNumberInput
              label="AI 生成素材保留天数"
              value={assetRetentionDays}
              onChange={setAssetRetentionDays}
              helper="启用真人演员库时必须设置 1–3650 天；关闭时 0 表示永久保留。仅清理 AI 生成图片和视频，系统每天北京时间 03:00 扫描。"
            />
            <AdminInput label="存储空间" value={storage} onChange={setStorage} />
            <AdminInput label="TikTok 账号数" value={tiktokAccounts} onChange={setTiktokAccounts} />
            <AdminInput label="CTA 文案" value={ctaLabel} onChange={setCtaLabel} />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="mb-4">
              <p className="text-sm font-semibold text-white">真人演员库权益</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                这些结构化额度由服务端强制执行；新套餐默认关闭，不能通过功能文案间接开启。
              </p>
            </div>
            <SegmentedField
              label="真人演员库"
              value={portraitEnabled ? 'enabled' : 'disabled'}
              onChange={value => {
                setPortraitEnabled(value === 'enabled');
                setError('');
              }}
              options={[
                { value: 'disabled', label: '关闭' },
                { value: 'enabled', label: '启用' },
              ]}
            />
            {portraitEnabled && (
              <div className="mt-4 space-y-4">
                <SegmentedField
                  label="可保存演员档案"
                  value={portraitProfileUnlimited ? 'unlimited' : 'limited'}
                  onChange={value => {
                    setPortraitProfileUnlimited(value === 'unlimited');
                    setError('');
                  }}
                  options={[
                    { value: 'limited', label: '有限额度' },
                    { value: 'unlimited', label: '不限' },
                  ]}
                />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {!portraitProfileUnlimited && (
                    <AdminNumberInput
                      label="演员档案上限"
                      value={portraitProfileLimit}
                      onChange={value => {
                        setPortraitProfileLimit(value);
                        setError('');
                      }}
                      helper="统计所有未删除档案，包括套餐锁定的演员。"
                    />
                  )}
                  <AdminNumberInput
                    label="同时激活上限"
                    value={portraitActiveLimit}
                    onChange={value => {
                      setPortraitActiveLimit(value);
                      setError('');
                    }}
                    helper="包含排队预留、认证、上传、处理和已有远端 Group。"
                  />
                  <SegmentedField
                    label="每名演员图片"
                    value={portraitAssetsPerActor}
                    onChange={value => {
                      setPortraitAssetsPerActor(value);
                      setError('');
                    }}
                    options={[
                      { value: '1', label: '1 张' },
                      { value: '2', label: '最多 2 张' },
                    ]}
                  />
                </div>
                <p className="text-xs leading-5 text-amber-200/80">
                  “不限”只代表站内档案不设上限；同时激活和全平台 45 Group / 45 Asset 软上限仍然生效。
                </p>
              </div>
            )}
          </div>
          <SegmentedField
            label="推荐标识"
            value={recommendation ?? 'none'}
            onChange={(value) => setRecommendation(value === 'none' ? null : value as PlanRecommendation)}
            options={[
              { value: 'none', label: '不设置' },
              { value: 'popular', label: '最受欢迎' },
              { value: 'enterprise', label: '企业首选' },
            ]}
          />
          <SegmentedField
            label="首页展示"
            value={landingVisible ? 'visible' : 'hidden'}
            onChange={(value) => setLandingVisible(value === 'visible')}
            options={[
              { value: 'hidden', label: '隐藏' },
              { value: 'visible', label: '展示' },
            ]}
          />
          <PlanIconSelector value={iconKey ?? 'sparkles'} onChange={setIconKey} />
          <AdminTextarea
            label="功能权益"
            value={featuresText}
            onChange={setFeaturesText}
            rows={7}
            helper="每行一条；使用 ✗ 开头表示用户端显示为未包含。"
          />
        </>
      )}

      <SegmentedField
        label="上下架状态"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'active', label: '启用中' },
          { value: 'disabled', label: '已停用' },
          { value: 'draft', label: '草稿' },
        ]}
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <Button loading={saving} onClick={() => void save()}>{plan ? '保存套餐' : '新增套餐'}</Button>
    </div>
  );
}

function PlanIconSelector({ value, onChange }: { value: PlanIconKey; onChange: (value: PlanIconKey) => void }) {
  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">套餐图标</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {PLAN_ICON_OPTIONS.map(option => {
          const Icon = option.icon;
          const active = option.key === value;

          return (
            <button
              key={option.key}
              type="button"
              aria-label={`选择${option.label}图标`}
              aria-pressed={active}
              data-plan-icon-key={option.key}
              onClick={() => onChange(option.key)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-all ${
                active
                  ? 'border-purple-500/60 bg-purple-500/20 text-white'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${getPlanIconGradientClass(option.key, 'from-purple-600 to-blue-600')} text-white`}>
                <Icon className="h-4 w-4" />
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function validatePlanEditForm(input: {
  name: string;
  code: string;
  description: string;
  ctaLabel: string;
  monthlyPriceYuan: number | null;
  yearlyPriceYuan: number | null;
  credits: number | null;
  assetRetentionDays: number | null;
  kind: AdminPlan['kind'];
  portraitEnabled: boolean;
  portraitProfileUnlimited: boolean;
  portraitProfileLimit: number | null;
  portraitActiveLimit: number | null;
  portraitAssetsPerActor: number | null;
}) {
  if (!input.name) return '请填写套餐名称';
  if (!input.code) return '请填写套餐代码';
  if (/\s/.test(input.code)) return '套餐代码不能包含空格';
  if (!input.description) return '请填写套餐简介';
  if (!input.ctaLabel) return '请填写 CTA 文案';
  if (input.monthlyPriceYuan === null || input.monthlyPriceYuan < 0) return '请填写有效的月付或一次性价格';
  if (input.kind === 'main' && (input.yearlyPriceYuan === null || input.yearlyPriceYuan < 0)) return '请填写有效的年付总价';
  if (input.credits === null || input.credits < 0) return '积分必须是非负整数';
  if (input.kind === 'main' && input.portraitEnabled && (
    input.assetRetentionDays === null
    || !Number.isInteger(input.assetRetentionDays)
    || input.assetRetentionDays < 1
    || input.assetRetentionDays > 3650
  )) return '启用真人演员库时，AI 生成素材保留天数必须是 1 到 3650 的整数';
  if (input.kind === 'main' && !input.portraitEnabled && (
    input.assetRetentionDays === null
    || !Number.isInteger(input.assetRetentionDays)
    || input.assetRetentionDays < 0
    || input.assetRetentionDays > 3650
  )) return 'AI 生成素材保留天数必须是 0 到 3650 的整数';
  if (input.kind === 'main' && input.portraitEnabled) {
    if (!input.portraitProfileUnlimited && (
      input.portraitProfileLimit === null
      || !Number.isInteger(input.portraitProfileLimit)
      || input.portraitProfileLimit < 1
    )) return '真人演员档案上限必须是正整数，或选择“不限”';
    if (
      input.portraitActiveLimit === null
      || !Number.isInteger(input.portraitActiveLimit)
      || input.portraitActiveLimit < 1
    ) return '真人演员同时激活上限必须是正整数';
    if (
      !input.portraitProfileUnlimited
      && input.portraitProfileLimit !== null
      && input.portraitActiveLimit > input.portraitProfileLimit
    ) return '真人演员同时激活上限不能超过档案上限';
    if (input.portraitAssetsPerActor !== 1 && input.portraitAssetsPerActor !== 2) {
      return '每名真人演员图片数必须是 1 或 2';
    }
  }
  return '';
}

export function SegmentedField<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">{label}</p>
      <div data-ui="admin-segmented-field" role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option, index) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-state={active ? 'active' : 'inactive'}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={event => {
                let nextIndex: number | null = null;
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % options.length;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = options.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                const nextOption = options[nextIndex];
                if (!nextOption) return;
                onChange(nextOption.value);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
              }}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                active
                  ? 'border-purple-500/60 bg-purple-500/20 text-white'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdminTextarea({ label, value, onChange, rows = 4, helper }: { label: string; value: string; onChange: (value: string) => void; rows?: number; helper?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={event => onChange(event.target.value)}
        data-ui="control"
        className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500/50"
      />
      {helper && <span className="mt-1 block text-xs text-gray-600">{helper}</span>}
    </label>
  );
}

export function AdminInput({ label, value, onChange, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        data-ui="control"
        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500/50 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}

export function AdminNumberInput({ label, value, onChange, helper }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={event => onChange(event.target.value)}
        data-ui="control"
        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500/50"
      />
      {helper && <span className="mt-1 block text-xs leading-5 text-gray-600">{helper}</span>}
    </label>
  );
}

function FormValidationError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
      {message}
    </div>
  );
}

const FINITE_NUMBER_INPUT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseFiniteNumberInput(value: string) {
  const trimmed = value.trim();
  if (!FINITE_NUMBER_INPUT.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerInput(value: string) {
  const parsed = parseFiniteNumberInput(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function parseNonnegativeIntegerInput(value: string) {
  const parsed = parseIntegerInput(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

export function OrderDetail({ order, invoiceRequest, creditEntries }: { order: AdminOrder; invoiceRequest?: AdminInvoiceRequest; creditEntries: AdminCreditLedgerEntry[] }) {
  const billingLabel = order.billing === 'yearly' ? '年付' : order.billing === 'monthly' ? '月付' : '一次性';

  return (
    <div className="space-y-4">
      <DetailGrid rows={[
        ['订单号', order.id],
        ['用户', `${order.userName} · ${order.email}`],
        ['订单类型', order.kind === 'main' ? '主套餐订单' : '加购包订单'],
        ['套餐', order.planName],
        ['金额', money(order.amount)],
        ['计费周期', billingLabel],
        ['支付状态', statusBadge(order.status)],
        ['积分到账状态', statusBadge(order.creditStatus)],
        ['到账积分', `${number(order.creditAmount)} · ${creditBucketLabel(order.creditBucket)}`],
        ['开票状态', statusBadge(order.invoiceStatus)],
        ['支付方式', order.paymentWayLabel ?? order.paymentMethodLabel ?? '在线支付'],
        ['商户订单号', order.merchantOrderNo ?? '-'],
        ['支付单号', order.paymentOrderNo ?? '-'],
        ['支付 attempt 状态', order.paymentAttemptStatus ? paymentAttemptStatusLabel(order.paymentAttemptStatus) : '-'],
        ['支付 attempt ID', order.paymentAttemptId ?? '-'],
        ['支付重试时间', formatRetryAfterMs(order.paymentRetryAfterMs) ?? '-'],
        ['退款状态', refundAttemptStatusLabel(order.refundAttemptStatus)],
        ['退款 attempt ID', order.refundAttemptId ?? '-'],
        ['退款重试时间', formatRetryAfterMs(order.refundRetryAfterMs) ?? '-'],
        ['退款单号', order.refundOrderNo ?? '-'],
        ['创建时间', order.createdAt],
        ['订单失效时间', order.paymentExpiresAt ?? '-'],
        ['支付时间', order.paidAt ?? '-'],
        ['失败时间', order.failedAt ?? '-'],
        ['退款时间', order.refundedAt ?? '-'],
        ...(order.paymentError ? [['支付说明', order.paymentError] as [string, string]] : []),
        ...(order.paymentAttemptError && order.paymentAttemptError !== order.paymentError
          ? [['支付 attempt 说明', order.paymentAttemptError] as [string, string]]
          : []),
        ...(order.refundError ? [['退款说明', order.refundError] as [string, string]] : []),
        ...(order.refundManualReviewReason
          ? [['人工核对原因', order.refundManualReviewReason] as [string, string]]
          : []),
      ]} />
      {creditEntries.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-semibold text-white">积分到账记录</p>
          <div className="mt-3 space-y-2">
            {creditEntries.map(entry => (
              <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2 text-sm">
                <Stack title={entry.source} subtitle={`${entry.time} · ${entry.id}`} />
                <span className={entry.amount >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>{entry.amount > 0 ? '+' : ''}{number(entry.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {invoiceRequest && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-semibold text-white">关联发票申请</p>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <Stack title="申请编号" subtitle={invoiceRequest.id} />
            <Stack title="发票抬头" subtitle={invoiceRequest.invoiceTitle} />
            <Stack title="接收邮箱" subtitle={invoiceRequest.receiveEmail} />
            <Stack title="申请时间" subtitle={invoiceRequest.requestedAt} />
          </div>
        </div>
      )}
    </div>
  );
}

export function InvoiceDetail({ invoice, order }: { invoice: AdminInvoiceRequest; order?: AdminOrder }) {
  return (
    <div className="space-y-4">
      <DetailGrid rows={[
        ['申请编号', invoice.id],
        ['开票状态', statusBadge(invoice.status)],
        ['关联订单', invoice.orderId],
        ['用户', `${invoice.userName} · ${invoice.email}`],
        ['套餐', invoice.planName],
        ['金额', money(invoice.amount)],
        ['发票抬头', invoice.invoiceTitle],
        ['税号', invoice.taxId],
        ['接收邮箱', invoice.receiveEmail],
        ['申请时间', invoice.requestedAt],
        ['开票时间', invoice.issuedAt ?? '-'],
      ]} />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-gray-500">补充说明</p>
        <p className="mt-2 text-sm text-white">{invoice.note}</p>
      </div>
      {order && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-semibold text-white">关联订单详情</p>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <Stack title="订单号" subtitle={order.id} />
            <Stack title="支付状态" subtitle={STATUS_MAP[order.status]?.label ?? order.status} />
            <Stack title="支付方式" subtitle={order.paymentMethod} />
            <Stack title="支付时间" subtitle={order.paidAt ?? '-'} />
          </div>
        </div>
      )}
    </div>
  );
}

/** 注册来源徽章：历史用户没有记录时显示「未知」。 */
export function acquisitionBadge(acquisition: AdminUser['acquisition']) {
  if (!acquisition) return <Badge variant="default">未知</Badge>;
  const variant: BadgeVariant = acquisition.source === 'direct' ? 'default'
    : acquisition.source === 'referral' ? 'purple'
    : acquisition.source === 'other' ? 'warning'
    : 'blue';
  return <Badge variant={variant}>{ACQUISITION_SOURCE_LABELS[acquisition.source]}</Badge>;
}

function describeAcquisition(acquisition: AdminUser['acquisition']) {
  if (!acquisition) return '-';
  const parts = [
    acquisition.rawSource ? `原始值 ${acquisition.rawSource}` : null,
    acquisition.medium ? `形式 ${acquisition.medium}` : null,
    acquisition.campaign ? `活动 ${acquisition.campaign}` : null,
    acquisition.content ? `内容 ${acquisition.content}` : null,
    acquisition.term ? `关键词 ${acquisition.term}` : null,
    acquisition.referrerHost ? `来源站点 ${acquisition.referrerHost}` : null,
    acquisition.landingPath ? `落地页 ${acquisition.landingPath}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : '-';
}

export function UserDetail({ user }: { user: AdminUser }) {
  return (
    <DetailGrid rows={[
      ['用户名', user.userName],
      ['邮箱', user.email],
      ['注册来源', acquisitionBadge(user.acquisition)],
      ['来源明细', describeAcquisition(user.acquisition)],
      ['套餐', user.planName],
      ['计费周期', user.billingCycle === 'yearly' ? '年付' : '月付'],
      ['周期开始时间', user.planCycleStartedAt],
      ['当前积分', `${number(user.credits)} / ${number(user.totalCredits)}`],
      ['主套餐积分', number(user.mainCredits)],
      ['加购包积分', number(user.addonCredits)],
      ['套餐重置时间', user.planResetAt ?? '-'],
      ['套餐到期时间', user.planExpiresAt ?? '-'],
      ['状态', statusBadge(user.status)],
      ['注册时间', user.registeredAt],
      ['最近活跃', user.lastActiveAt],
      ['订单数量', user.orderCount],
      ['API 调用', number(user.apiCalls)],
      ['工单数量', user.ticketCount],
    ]} />
  );
}

export function ConsumptionCreditsForm({ rows, currentCredits, onSubmit }: {
  rows: Array<[string, ReactNode]>;
  currentCredits: number;
  onSubmit: (credits: number) => void;
}) {
  const [credits, setCredits] = useState(String(currentCredits));
  const [error, setError] = useState('');

  const submit = () => {
    const parsedCredits = parseNonnegativeIntegerInput(credits);
    if (parsedCredits === null) {
      setError('积分必须是非负整数');
      return;
    }
    setError('');
    onSubmit(parsedCredits);
  };

  return (
    <div className="space-y-4">
      <DetailGrid rows={rows} />
      <AdminNumberInput label="修改后积分" value={credits} onChange={value => {
        setCredits(value);
        setError('');
      }} />
      {error && <FormValidationError message={error} />}
      <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4 text-xs leading-5 text-purple-100">
        修改后会同步影响用户端 AI Studio 生成按钮展示。提交后仍需二次确认才会生效。
      </div>
      <div className="flex justify-end">
        <Button onClick={submit}>提交修改</Button>
      </div>
    </div>
  );
}

export function VideoConsumptionCreditsForm({ rows, currentCredits, currentReferenceVideoCredits, onSubmit }: {
  rows: Array<[string, ReactNode]>;
  currentCredits: number;
  currentReferenceVideoCredits: number;
  onSubmit: (credits: number, referenceVideoCredits: number) => void;
}) {
  const [credits, setCredits] = useState(String(currentCredits));
  const [referenceVideoCredits, setReferenceVideoCredits] = useState(String(currentReferenceVideoCredits));
  const [error, setError] = useState('');

  const submit = () => {
    const parsedCredits = parseNonnegativeIntegerInput(credits);
    const parsedReferenceVideoCredits = parseNonnegativeIntegerInput(referenceVideoCredits);
    if (parsedCredits === null || parsedReferenceVideoCredits === null) {
      setError('积分必须是非负整数');
      return;
    }
    setError('');
    onSubmit(parsedCredits, parsedReferenceVideoCredits);
  };

  return (
    <div className="space-y-4">
      <DetailGrid rows={rows} />
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminNumberInput label="无参考视频积分" value={credits} onChange={value => {
          setCredits(value);
          setError('');
        }} />
        <AdminNumberInput
          label="含参考视频积分"
          value={referenceVideoCredits}
          onChange={value => {
            setReferenceVideoCredits(value);
            setError('');
          }}
        />
      </div>
      {error && <FormValidationError message={error} />}
      <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4 text-xs leading-5 text-purple-100">
        只有参考素材中存在视频时才使用含参考视频档；图片、音频、首尾帧和纯提示词使用无参考视频档。提交后仍需二次确认才会生效。
      </div>
      <div className="flex justify-end">
        <Button onClick={submit}>提交修改</Button>
      </div>
    </div>
  );
}

export function TicketDetail({ ticket }: { ticket: AdminTicket }) {
  return (
    <div className="space-y-4">
      <DetailGrid rows={[
        ['工单号', ticket.id],
        ['用户', `${ticket.userName} · ${ticket.email}`],
        ['优先级', statusBadge(ticket.priority)],
        ['状态', statusBadge(ticket.status)],
        ['负责人', ticket.assignee],
        ['SLA', `${ticket.slaHours} 小时`],
        ['创建时间', ticket.createdAt],
        ['更新时间', ticket.updatedAt],
      ]} />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-gray-500">最近消息</p>
        <p className="mt-2 text-sm text-white">{ticket.lastMessage}</p>
        <p className="mt-4 text-xs text-gray-500">内部备注</p>
        <p className="mt-2 text-sm text-gray-300">{ticket.internalNote}</p>
      </div>
    </div>
  );
}

export function TicketConversation({
  ticket,
  onMessagesLoad,
  onRead,
  onReply,
  onStatusChange,
  setConfirm,
}: {
  ticket: AdminTicket;
  onMessagesLoad: (ticketId: string) => Promise<TicketMessage[]>;
  onRead: (ticketId: string) => Promise<void>;
  onReply: (ticketId: string, message: string) => Promise<TicketMessage>;
  onStatusChange: (ticket: AdminTicket, status: AdminTicket['status']) => Promise<void>;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(ticket.status);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let canceled = false;
    setMessages([]);
    setLoading(true);
    onMessagesLoad(ticket.id)
      .then(nextMessages => {
        if (!canceled) setMessages(nextMessages);
      })
      .catch(error => {
        if (!canceled && !isAbortError(error)) toast.error('工单消息加载失败，请稍后重试');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [onMessagesLoad, ticket.id]);

  useEffect(() => {
    if (ticket.unreadCount <= 0) return;

    let canceled = false;
    void onRead(ticket.id).catch(error => {
      if (!canceled && !isAbortError(error)) {
        toast.warning('工单已读状态更新失败，稍后重新打开将自动重试');
      }
    });

    return () => {
      canceled = true;
    };
  }, [onRead, ticket.id, ticket.unreadCount]);

  useEffect(() => {
    if (loading) return;
    const messageList = messagesRef.current;
    if (!messageList) return;
    messageList.scrollTo({ top: messageList.scrollHeight });
  }, [loading, messages.length, ticket.id]);

  const submitReply = async () => {
    const body = reply.trim();
    if (!body) {
      toast.error('请填写回复内容');
      return;
    }
    if (status === 'resolved') {
      toast.error('工单已关闭，不能继续回复');
      return;
    }

    try {
      setSubmitting(true);
      const message = await onReply(ticket.id, body);
      setMessages(prev => [...prev, message]);
      setReply('');
      setStatus('pending');
      toast.success('回复已发送');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '回复发送失败');
    } finally {
      setSubmitting(false);
    }
  };

  const closeTicket = () => {
    setConfirm({
      title: '确认关闭工单？',
      description: `${ticket.id} 将标记为已解决。关闭后用户和管理员都不能继续回复。`,
      confirmLabel: '关闭工单',
      onConfirm: async () => {
        try {
          await onStatusChange({ ...ticket, status }, 'resolved');
          setStatus('resolved');
          toast.success('工单已关闭');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '工单状态更新失败');
        }
      },
    });
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,220px)_minmax(0,1fr)] gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1">
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <DetailGrid rows={[
          ['工单号', ticket.id],
          ['用户', `${ticket.userName} · ${ticket.email}`],
          ['优先级', statusBadge(ticket.priority)],
          ['状态', statusBadge(status)],
          ['负责人', ticket.assignee],
          ['SLA', `${ticket.slaHours} 小时`],
          ['创建时间', ticket.createdAt],
          ['更新时间', ticket.updatedAt],
          ['消息数', ticket.messageCount],
        ]} />
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-500">最近消息</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white">{ticket.lastMessage}</p>
          <p className="mt-4 text-xs text-gray-500">内部备注</p>
          <p className="mt-2 text-sm text-gray-300">{ticket.internalNote || '暂无内部备注'}</p>
        </div>
        <Button variant="primary" disabled={status === 'resolved'} onClick={closeTicket}>
          关闭工单
        </Button>
      </div>

      <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 px-4 py-3">
          <p className="text-sm font-semibold text-white">回复记录</p>
          <p className="mt-1 text-xs text-gray-500">关闭工单前，用户和管理员可持续对话。</p>
        </div>
        <div ref={messagesRef} data-testid="admin-ticket-message-list" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-gray-500">正在加载消息...</p>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">暂无消息记录</p>
          ) : (
            messages.map(message => <AdminTicketMessage key={message.id} message={message} />)
          )}
        </div>
        <div className="border-t border-white/10 p-4">
          {status === 'resolved' ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              工单已关闭，回复区域只读。
            </div>
          ) : (
            <div className="space-y-3">
              <AdminTextarea label="回复用户" value={reply} onChange={setReply} rows={4} />
              <div className="flex justify-end">
                <Button loading={submitting} icon={<SendHorizontal className="h-4 w-4" />} onClick={submitReply}>
                  发送回复
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminTicketMessage({ message }: { message: TicketMessage }) {
  const isAdmin = message.authorRole === 'admin';
  return (
    <div className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] rounded-2xl px-4 py-3 ${
        isAdmin
          ? 'bg-purple-600 text-white'
          : 'border border-white/10 bg-white/10 text-gray-100'
      }`}>
        <div className={`mb-1 flex items-center gap-2 text-[11px] ${isAdmin ? 'text-purple-100' : 'text-gray-500'}`}>
          <span>{isAdmin ? '管理员' : message.authorName || '用户'}</span>
          <span>{message.createdAt}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
      </div>
    </div>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function CreditDetail({ entry }: { entry: AdminCreditLedgerEntry }) {
  return (
    <DetailGrid rows={[
      ['时间', entry.time],
      ['用户', `${entry.userName} · ${entry.email}`],
      ['类型', statusBadge(entry.type)],
      ['积分来源', creditBucketLabel(entry.bucket)],
      ['结算状态', entry.settlementStatus ? statusBadge(entry.settlementStatus) : '-'],
      ['积分变动', <span className={entry.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</span>],
      ['余额', number(entry.balance)],
      ['来源', entry.source],
      ['操作人', entry.operator],
      ['关联订单', entry.relatedOrderId ?? '-'],
      ['关联任务', entry.relatedJobId ?? '-'],
      ['关联资产', entry.relatedAssetId ?? '-'],
      ['备注', entry.note],
    ]} />
  );
}

export function JobDetail({ job }: { job: AdminGenerationJob }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.1fr]">
      <DetailGrid rows={[
        ['任务号', job.id],
        ['用户', `${job.userName} · ${job.email}`],
        ['类型', job.kind === 'video' ? 'AI 视频' : 'AI 图片'],
        ['模型', job.model],
        ['状态', statusBadge(generationJobDisplayStatus(job))],
        ...(generationJobReviewMessage(job) ? [['处理提示', generationJobReviewMessage(job)] as [string, ReactNode]] : []),
        ['配置', job.config],
        ['耗时', job.duration],
        ['预扣积分', number(job.reservedCredits)],
        ['实扣积分', number(job.settledCredits)],
        ['退回积分', number(job.refundedCredits)],
        ['积分状态', statusBadge(job.creditStatus)],
        ['主套餐扣减', number(job.mainCreditsUsed)],
        ['加购包扣减', number(job.addonCreditsUsed)],
        ['重试次数', job.retryCount],
        ['当前 attempt', job.attempt ?? '-'],
        ['处理阶段', job.processingStage ?? '-'],
        ['取消状态', job.cancelState ?? '-'],
        ['worker epoch', job.claimEpoch ?? '-'],
        ['供应商 run', job.providerRunId ?? '-'],
        ['run 状态', job.providerRunStatus ?? '-'],
        ['供应商任务号', job.providerTaskId ?? '-'],
        ['处理异常', job.settlementError ?? '-'],
        ['租约心跳', job.heartbeatAt ?? '-'],
        ['租约到期', job.leaseExpiresAt ?? '-'],
        ['失败分类', job.failCategory ? statusBadge(job.failCategory) : '-'],
        ['失败原因', job.failReason ?? '-'],
        ['关联资产', job.assetId ? `${job.assetName ?? '-'} · ${job.assetId}` : '-'],
        ['关联流水', job.ledgerIds?.join('、') ?? '-'],
      ]} />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-gray-500">提示词</p>
        <p className="mt-2 text-sm leading-6 text-white">{job.prompt}</p>
      </div>
    </div>
  );
}

export function AuditDetail({ log }: { log: AdminAuditLog }) {
  return (
    <DetailGrid rows={[
      ['时间', log.time],
      ['管理员', log.admin],
      ['模块', log.module],
      ['操作', log.action],
      ['对象', log.target],
      ['风险等级', statusBadge(log.risk)],
      ['IP', log.ip],
      ['详情', log.detail],
    ]} />
  );
}
