import { ACQUISITION_SOURCE_LABELS } from '@lindyson/api-contracts';
import {
  Activity,
  Bot,
  Clock,
  Coins,
  FileText,
  KeyRound,
  MessageSquare,
  Share2,
  TrendingUp,
  UserCog,
  Users,
  WalletCards,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { Area,AreaChart,Cell,Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts';
import {
  type AdminOverviewSummary,
  type AdminPlan,
} from '../../data/admin';
import { Badge,Card } from '../../ui';

import {
  MetricCard,
  PageShell,
  PlanDetail,
  money,
  number,
} from '../components/AdminPageShared';
import type { AdminTab,DetailState } from '../types';

const MODEL_USAGE_COLORS = ['#8b5cf6', '#3b82f6', '#ef4444', '#ec4899', '#22c55e', '#f59e0b'];
const MODEL_USAGE_COLOR_BY_MODEL: Record<string, string> = {
  'Seedance 2.5': '#f59e0b',
  'Seedance 2.0': '#8b5cf6',
  'Seedance 2.0 Mini': '#3b82f6',
  'Seedance 2.0 Fast': '#ef4444',
  'Seedream 5.0 Pro': '#06b6d4',
  'Doubao Seed 2.0 Lite': '#22c55e',
};
const CURRENT_USAGE_MODELS = [
  'Seedance 2.5',
  'Seedance 2.0',
  'Seedance 2.0 Mini',
  'Seedance 2.0 Fast',
  'Seedream 5.0 Pro',
  'Doubao Seed 2.0 Lite',
] as const;

export function AdminOverviewPage({ summary, plans, setActiveTab, setDetail }: {
  summary: AdminOverviewSummary | null;
  plans: AdminPlan[];
  setActiveTab: (tab: AdminTab) => void;
  setDetail: (detail: DetailState) => void;
}) {
  const revenueTrend = useMemo(
    () => (summary?.revenueTrend ?? []).map(item => ({ ...item, day: formatOverviewDay(item.day) })),
    [summary],
  );
  const usageMixSorted = useMemo(() => buildUsageMix(summary?.modelUsage ?? []), [summary]);
  const acquisitionMix = useMemo(() => buildAcquisitionMix(summary?.acquisitionMix ?? []), [summary]);
  const modelUsageTotal = useMemo(
    () => (summary?.modelUsage ?? []).reduce((total, item) => total + item.billableTokens, 0),
    [summary],
  );
  const modelUsageSummary = usageMixSorted.map(item => `${item.name} ${item.value}%`).join('，');
  const operationalAlerts: Array<{
    icon: LucideIcon;
    title: string;
    desc: string;
    tab: AdminTab;
    tone: 'critical' | 'warning' | 'info';
  }> = [];
  if (summary && summary.sevenDayPaymentFailures > 0) {
    operationalAlerts.push({ icon: XCircle, title: `${summary.sevenDayPaymentFailures} 笔支付失败待排查`, desc: '近 7 日支付失败订单，请检查支付回调或用户重试情况。', tab: 'orders', tone: 'critical' });
  }
  if (summary && summary.openTickets > 0) {
    operationalAlerts.push({ icon: MessageSquare, title: `${summary.openTickets} 个工单待处理`, desc: '仍有未解决工单，请优先处理高优先级和接近 SLA 的问题。', tab: 'tickets', tone: 'warning' });
  }
  if (summary && summary.pendingInvoices > 0) {
    operationalAlerts.push({ icon: FileText, title: `${summary.pendingInvoices} 个发票申请待处理`, desc: '用户已提交发票申请，需财务人工标记开票状态。', tab: 'invoices', tone: 'info' });
  }
  if (summary && summary.sevenDayApiSuccessRate < 95) {
    operationalAlerts.push({ icon: Activity, title: `API 成功率 ${summary.sevenDayApiSuccessRate}%`, desc: '近 7 日供应商接口成功率偏低，建议查看失败任务和供应商状态。', tab: 'api-usage', tone: summary.sevenDayApiSuccessRate < 80 ? 'critical' : 'warning' });
  }
  if (summary && summary.apiCostHealth.syncStatus !== 'normal') {
    operationalAlerts.push({ icon: KeyRound, title: '费用中心数据需要关注', desc: '余额或账单快照尚未同步、已过期或最近同步失败；旧快照不会被清零。', tab: 'api-usage', tone: 'warning' });
  }
  if (summary?.apiCostHealth.matchState === 'residual') {
    const residualTokens = summary.apiCostHealth.residualTokens;
    operationalAlerts.push({
      icon: Activity,
      title: '官方与本地仍有未解释残差',
      desc: `官方减调整后本地为 ${formatSignedInteger(residualTokens)} Token / ${formatSignedCny(summary.apiCostHealth.residualCostCny)}，请按对账证据链排查。`,
      tab: 'api-usage',
      tone: 'critical',
    });
  }
  if (summary && summary.failedJobs > 0) {
    operationalAlerts.push({ icon: Bot, title: `${summary.failedJobs} 个生成任务失败`, desc: '生成任务存在失败记录，可进入任务页查看失败原因并重新提交真实任务。', tab: 'jobs', tone: 'critical' });
  }

  return (
    <PageShell width="dashboard" eyebrow="OPERATIONS OVERVIEW" title="管理员仪表盘" subtitle="集中查看收入、用户、生成任务、API 与工单健康度">
      <section aria-labelledby="admin-business-overview" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="admin-business-overview" className="text-sm font-semibold text-[var(--admin-text-primary)]">经营概览</h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">收入、用户与待处理事项均使用服务端真实统计</p>
          </div>
          <Badge variant="default">北京时间</Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={WalletCards} label="今日收入" value={summary ? money(summary.todayRevenue) : '—'} helper={summary ? '按服务端北京时间统计确认收入' : '服务端统计暂不可用'} tone="purple" />
          <MetricCard icon={TrendingUp} label="本月收入" value={summary ? money(summary.monthRevenue) : '—'} helper={summary ? '本月已支付订单确认收入' : '服务端统计暂不可用'} tone="blue" />
          <MetricCard icon={Coins} label="总收入" value={summary ? money(summary.totalRevenue) : '—'} helper={summary ? '全部已支付订单确认收入' : '服务端统计暂不可用'} tone="green" />
          <MetricCard icon={XCircle} label="支付失败数" value={summary ? number(summary.sevenDayPaymentFailures) : '—'} helper={summary ? '近 7 日支付失败订单' : '服务端统计暂不可用'} tone="orange" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard density="compact" icon={UserCog} label="本月新增用户" value={summary ? number(summary.monthNewUsers) : '—'} helper={summary ? '按注册时间统计本月新增账号' : '服务端统计暂不可用'} tone="blue" />
          <MetricCard density="compact" icon={Clock} label="非活跃用户" value={summary ? number(summary.inactiveUsers) : '—'} helper={summary ? '超 30 天未登录' : '服务端统计暂不可用'} tone="orange" />
          <MetricCard density="compact" icon={Users} label="总注册用户" value={summary ? number(summary.totalUsers) : '—'} helper={summary ? '当前后台注册用户总数' : '服务端统计暂不可用'} tone="neutral" />
          <MetricCard density="compact" icon={Activity} label="API 成功率" value={summary ? `${summary.sevenDayApiSuccessRate}%` : '—'} helper={summary ? (summary.sevenDayApiRequests > 0 ? `近 7 日供应商接口成功率，${summary.sevenDayApiSuccesses}/${summary.sevenDayApiRequests} 成功` : '近 7 日暂无真实供应商任务') : '服务端统计暂不可用'} tone={summary && summary.sevenDayApiSuccessRate < 95 ? 'orange' : 'green'} />
          <MetricCard density="compact" icon={MessageSquare} label="待处理工单" value={summary ? number(summary.openTickets) : '—'} helper={summary ? '未解决工单总数' : '服务端统计暂不可用'} tone="pink" />
          <MetricCard density="compact" icon={FileText} label="待开发票" value={summary ? number(summary.pendingInvoices) : '—'} helper={summary ? '已申请但尚未开票' : '服务端统计暂不可用'} tone="purple" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]">
        <Card variant="raised" data-admin-ui="chart-panel" className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">收入与订单趋势</h2>
              <p className="mt-1 text-xs text-gray-500">用于判断套餐购买与订单波动</p>
            </div>
            <Badge variant="purple">近 7 天</Badge>
          </div>
          <div data-ui="admin-chart-plot" className="h-[280px] rounded-2xl border border-white/[0.06] bg-[var(--admin-surface-inset)] px-2 pb-1 pt-3">
            {summary ? (
              <ResponsiveContainer width="100%" height="100%" aria-label="近 7 天收入与订单趋势">
                <AreaChart data={revenueTrend} margin={{ top: 12, right: 16, left: -10, bottom: 4 }}>
                  <defs>
                    <linearGradient id="adminRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} height={28} dy={6} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    tickFormatter={(value) => formatRevenueAxis(Number(value))}
                    width={58}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0b0c12', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, color: '#f6f3ee', boxShadow: '0 18px 48px rgba(0,0,0,.38)' }}
                    formatter={value => [money(Number(value)), '收入']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#a78bfa" strokeWidth={2} fill="url(#adminRevenue)" name="收入" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <UnavailablePanel label="收入趋势统计暂不可用" />
            )}
          </div>
        </Card>

        <Card variant="raised" data-admin-ui="chart-panel" className="p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-white">模型使用占比</h2>
            <p className="mt-1 text-xs text-gray-500">辅助判断模型成本与调用结构</p>
          </div>
          <div
            data-ui="admin-chart-plot"
            role="img"
            aria-label={usageMixSorted.length > 0 ? `模型使用占比：${modelUsageSummary}` : '模型使用占比：暂无真实模型用量'}
            className="relative h-[190px] rounded-2xl border border-white/[0.06] bg-[var(--admin-surface-inset)]"
          >
            {!summary ? (
              <UnavailablePanel label="模型用量统计暂不可用" />
            ) : usageMixSorted.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={usageMixSorted.filter(item => item.value > 0)}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      outerRadius={76}
                      innerRadius={52}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={3}
                      cornerRadius={5}
                      stroke="#090a0f"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {usageMixSorted.filter(item => item.value > 0).map(item => <Cell key={item.name} fill={item.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-extrabold tracking-[-0.02em] text-[var(--admin-text-primary)]">{formatCompactInteger(modelUsageTotal)}</span>
                  <span className="mt-1 text-[10px] text-[var(--admin-text-muted)]">计费 Token</span>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-center text-sm text-gray-500">
                暂无真实模型用量
              </div>
            )}
          </div>
          {usageMixSorted.length > 0 && (
            <div aria-label="模型使用占比明细" className="mt-4 space-y-2">
              {usageMixSorted.map(item => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-gray-400">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                    {item.name}
                  </span>
                  <span className="font-semibold text-white">{item.value}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card variant="raised" data-admin-ui="chart-panel" className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">注册来源分布</h2>
            <p className="mt-1 text-xs text-gray-500">本月新注册账号按推广链接与来源站点归类，历史用户无来源不计入</p>
          </div>
          <Badge variant="blue">本月</Badge>
        </div>
        {!summary ? (
          <div className="h-[72px]"><UnavailablePanel label="来源统计暂不可用" /></div>
        ) : acquisitionMix.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-gray-500">本月暂无带来源记录的注册</div>
        ) : (
          <div aria-label="注册来源分布明细" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {acquisitionMix.map(item => (
              <button
                key={item.source}
                type="button"
                data-ui="admin-acquisition-row"
                onClick={() => setActiveTab('users')}
                className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-left transition-[background-color,border-color] duration-[180ms] hover:border-white/[0.13] hover:bg-white/[0.045]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Share2 className="h-3.5 w-3.5 text-gray-400" />
                    {item.label}
                  </span>
                  <span className="text-xs text-gray-400">{item.share}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-[#60a5fa]" style={{ width: `${item.share}%` }} />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  注册 {number(item.registrations)} · 付费 {number(item.paidUsers)} · 收入 {money(item.revenue)}
                </p>
              </button>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card variant="raised" data-admin-ui="alert-panel" className="p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">运营异常提醒</h2>
            <Badge variant="orange">动态提醒</Badge>
          </div>
          <div className="space-y-3">
            {operationalAlerts.map(alert => {
              const Icon = alert.icon;
              return (
                <button key={alert.title} data-ui="admin-alert" data-tone={alert.tone} type="button" onClick={() => setActiveTab(alert.tab)} className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-[background-color,border-color,transform] duration-[180ms]">
                  <div data-ui="admin-alert-icon" className="rounded-lg border p-2"><Icon className="w-4 h-4" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{alert.title}</p>
                    <p className="mt-1 text-xs text-gray-500">{alert.desc}</p>
                  </div>
                </button>
              );
            })}
            {operationalAlerts.length === 0 && summary && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-sm font-semibold text-white">暂无需要立即处理的运营异常</p>
                <p className="mt-1 text-xs text-gray-400">支付、工单、发票、供应商额度和生成任务均处于稳定状态。</p>
              </div>
            )}
            {operationalAlerts.length === 0 && !summary && (
              <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-4" role="status">
                <p className="text-sm font-semibold text-white">运营统计暂不可用</p>
                <p className="mt-1 text-xs text-gray-400">未使用当前列表估算异常数量，请稍后刷新获取服务端完整聚合。</p>
              </div>
            )}
          </div>
        </Card>

        <Card variant="raised" data-admin-ui="plan-panel" className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">当前套餐结构</h2>
          <div className="space-y-3">
            {plans.map(plan => (
              <button
                key={plan.id}
                data-ui="admin-plan-row"
                type="button"
                onClick={() => setDetail({ title: plan.name, subtitle: '套餐概览', content: <PlanDetail plan={plan} /> })}
                className="flex w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-left transition-[background-color,border-color,transform] duration-[180ms] hover:border-white/[0.13] hover:bg-white/[0.045]"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{plan.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{plan.subscribers} 个订阅用户</p>
                </div>
                <span className="text-sm font-semibold text-purple-300">{money(plan.revenue)}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}

export function buildUsageMix(modelUsage: AdminOverviewSummary['modelUsage']) {
  const total = modelUsage.reduce((sum, item) => sum + item.billableTokens, 0);
  if (total <= 0) return [];

  const rows = [...modelUsage];
  for (const model of CURRENT_USAGE_MODELS) {
    if (!rows.some(item => item.model === model)) {
      rows.push({ model, billableTokens: 0 });
    }
  }

  return rows
    .sort((left, right) => right.billableTokens - left.billableTokens || left.model.localeCompare(right.model))
    .map((item, index) => ({
      name: item.model,
      value: Math.round((item.billableTokens / total) * 100),
      color: MODEL_USAGE_COLOR_BY_MODEL[item.model] ?? MODEL_USAGE_COLORS[index % MODEL_USAGE_COLORS.length],
    }));
}

function formatOverviewDay(value: string) {
  const [, month, day] = value.split('-');
  return month && day ? `${Number(month)}月${Number(day)}日` : value;
}

function formatRevenueAxis(valueInCents: number) {
  return `¥${new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(valueInCents / 100)}`;
}

function formatCompactInteger(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedInteger(value: number | null) {
  if (value === null) return '数据不可用';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('zh-CN')}`;
}

function formatSignedCny(value: string | null) {
  if (value === null) return '数据不可用';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  const sign = parsed > 0 ? '+' : parsed < 0 ? '-' : '';
  return `${sign}¥${Math.abs(parsed).toLocaleString('zh-CN', {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  })}`;
}

/** 来源分布：按注册数排序并计算占比，占比四舍五入后总和可能略偏离 100。 */
export function buildAcquisitionMix(items: AdminOverviewSummary['acquisitionMix']) {
  const total = items.reduce((sum, item) => sum + item.registrations, 0);
  return [...items]
    .sort((a, b) => b.registrations - a.registrations || b.revenue - a.revenue || a.source.localeCompare(b.source))
    .map(item => ({
      ...item,
      label: ACQUISITION_SOURCE_LABELS[item.source] ?? item.source,
      share: total > 0 ? Math.round((item.registrations / total) * 100) : 0,
    }));
}

function UnavailablePanel({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 text-center text-sm text-orange-200" role="status">
      {label}
    </div>
  );
}
