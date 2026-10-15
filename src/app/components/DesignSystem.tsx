import { ArrowRight,Building2,CheckSquare,ChevronDown,Coins,CreditCard,Download,Ellipsis,FolderOpen,Headphones,Image as ImageIcon,LogOut,Mail,PieChart,ReceiptText,RotateCcw,Save,Search,ShieldCheck,Sparkles,Star,Upload,Users,Video,X,Zap } from 'lucide-react';
import { useState } from 'react';
import {
  CAPABILITY_STATUS_LABELS,
  PRODUCT_BRAND,
  PRODUCT_CAPABILITIES,
  PRODUCT_CAPABILITY_COPY,
  PRODUCT_CAPABILITY_LIST,
} from '../data/capabilities';
import { Badge,Button,Card,CardBody,CardHeader,DatePicker,EmptyState,GradientText,Input,PageHeader,QueueItem,SectionHeader,Select,StatCard,StudioTab,StudioTabList,TabBar,Textarea,Toggle,UploadZone } from '../ui';
import { CursorPagination } from './CursorPagination';

type Section = 'handoff' | 'public' | 'colors' | 'typography' | 'buttons' | 'cards' | 'subscription' | 'forms' | 'badges' | 'components' | 'assets' | 'charts' | 'account' | 'admin' | 'layout';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'handoff',    label: '交接总览' },
  { id: 'public',     label: '官网登录' },
  { id: 'colors',     label: '颜色' },
  { id: 'typography', label: '字体' },
  { id: 'buttons',    label: '按钮' },
  { id: 'cards',      label: '卡片' },
  { id: 'subscription', label: '订阅套餐' },
  { id: 'forms',      label: '表单' },
  { id: 'badges',     label: '徽章' },
  { id: 'components', label: '组件' },
  { id: 'assets',     label: '素材资产' },
  { id: 'charts',     label: '数据图表' },
  { id: 'account',    label: '账户中心' },
  { id: 'admin',      label: '管理后台' },
  { id: 'layout',     label: '布局' },
];

const capabilityStatusClasses = {
  live: 'border-green-500/20 bg-green-500/10 text-green-200',
  gated: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
  planned: 'border-blue-500/20 bg-blue-500/10 text-blue-100',
} as const;

function DSSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-white border-b border-white/10 pb-2">{title}</h2>
      {children}
    </div>
  );
}

function DSRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 font-mono">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const assetCardClass = 'relative rounded-2xl overflow-hidden border border-white/10 bg-white/5';

function AssetLibraryLayoutPreview() {
  const [searchDraft,setSearchDraft] = useState('');
  const folders = [
    ['主目录', '2'],
    ['产品发布', '2'],
    ['广告归档', '0'],
  ];

  return (
    <Card className="w-full max-w-4xl overflow-hidden p-0">
      <div className="grid min-h-[360px] xl:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="文件夹预览" className="hidden border-r border-white/10 bg-black/15 p-3 xl:block">
          <div className="mb-3 flex items-center justify-between px-2">
            <p className="text-xs font-semibold text-white">文件夹</p>
            <span className="text-[10px] text-gray-500">单层目录</span>
          </div>
          <ul className="space-y-1">
            {folders.map(([name, count], index) => (
              <li key={name} className={`grid min-h-11 grid-cols-[minmax(0,1fr)_2rem_3rem] items-center gap-2 rounded-xl px-3 text-xs ${index === 0 ? 'bg-violet-500/15 text-violet-100' : 'text-gray-400'}`}>
                <span className="flex min-w-0 items-center gap-2">
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                </span>
                <span className="min-w-8 text-right font-mono tabular-nums">{count}</span>
                <span aria-hidden="true" className="h-11" />
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-gray-500">AI视频 / 主目录</p>
              <p className="mt-1 text-sm font-semibold text-white">2 个素材</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <form className="relative col-span-2 w-full sm:w-[clamp(200px,18vw,260px)]" onSubmit={event => event.preventDefault()}>
                <input
                  value={searchDraft}
                  onChange={event => setSearchDraft(event.target.value)}
                  aria-label="搜索AI视频全部文件夹"
                  placeholder="搜索素材"
                  className={`h-11 w-full rounded-xl border border-white/15 bg-white/5 pl-3 text-xs text-white placeholder:text-gray-500 focus:border-purple-400/60 focus:outline-none ${searchDraft ? 'pr-[5.5rem]' : 'pr-11'}`}
                />
                {searchDraft && (
                  <button type="button" aria-label="清除搜索" onClick={() => setSearchDraft('')} className="absolute right-11 top-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button type="submit" aria-label="搜索素材" className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-violet-200 hover:bg-white/10 hover:text-white">
                  <Search className="h-4 w-4" />
                </button>
              </form>
              <Button size="sm" variant="secondary" className="min-h-11 flex-1 sm:flex-none" icon={<CheckSquare className="h-3.5 w-3.5" />}>批量操作</Button>
              <Button size="sm" className="min-h-11 flex-1 sm:flex-none" icon={<Upload className="h-3.5 w-3.5" />}>上传素材</Button>
            </div>
          </div>
          <div className="@container/asset-preview-grid mt-4">
            <div className="grid grid-cols-2 gap-4 @min-[476px]/asset-preview-grid:grid-cols-3 @min-[804px]/asset-preview-grid:grid-cols-5 @min-[968px]/asset-preview-grid:grid-cols-6 @min-[1624px]/asset-preview-grid:grid-cols-10">
              <AssetPreviewCard />
              <AssetPreviewCard downloaded />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AssetCategoryTabsPreview({ active,onChange }: { active: string; onChange: (id: string) => void }) {
  const tabs = [
    { id: 'video', label: 'AI视频', count: 2, accent: 'violet', icon: <Video className="h-4 w-4" /> },
    { id: 'image', label: 'AI图片', count: 0, accent: 'pink', icon: <ImageIcon className="h-4 w-4" /> },
    { id: 'uploaded-video', label: '已上传视频', count: 3, accent: 'blue', icon: <Video className="h-4 w-4" /> },
    { id: 'uploaded-image', label: '已上传图片', count: 37, accent: 'pink', icon: <ImageIcon className="h-4 w-4" /> },
    { id: 'uploaded-audio', label: '已上传音频', count: 0, accent: 'cyan', icon: <Headphones className="h-4 w-4" /> },
  ] as const;
  return (
    <StudioTabList aria-label="数字资产分类示例">
      {tabs.map((tab,index) => (
        <StudioTab
          key={tab.id}
          active={active === tab.id}
          accent={tab.accent}
          icon={tab.icon}
          density="compact"
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={event => {
            let nextIndex: number | null = null;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
            if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = tabs.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            const next = tabs[nextIndex];
            onChange(next.id);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
          }}
        >
          <span>{tab.label}</span>
          <span data-ui="asset-category-count" className="tabular-nums text-current/75">{tab.count}</span>
        </StudioTab>
      ))}
    </StudioTabList>
  );
}

function AssetPreviewCard({ downloaded = false }: { downloaded?: boolean }) {
  return (
    <div className={assetCardClass}>
      <div className="relative aspect-[9/16] bg-black/20 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=320&q=80"
          alt="产品发布宣传片"
          className="w-full h-full object-cover"
        />
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs flex items-center gap-1 bg-purple-600/80 text-white">
          <Video className="w-3 h-3" />0:45
        </div>
        <button type="button" aria-label="更多操作：产品发布宣传片" className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-black/75 text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300">
          <Ellipsis className="h-5 w-5" />
        </button>
        <button type="button" aria-label={downloaded ? '重新下载素材 产品发布宣传片（已发起过下载）' : '下载素材 产品发布宣传片'} className={`absolute bottom-2 right-2 inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${downloaded ? 'border-emerald-300/40 bg-emerald-500/20 text-emerald-300' : 'border-white/20 bg-black/75 text-white'}`}>
          <Download className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3">
        <p className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-white">产品发布宣传片</p>
        <p className="mt-1.5 truncate text-xs text-gray-400">0:45 · 128 MB</p>
        <time dateTime="2026-08-12" className="mt-1 block text-xs text-gray-500">2026-08-12</time>
      </div>
    </div>
  );
}

function PiePreviewCard() {
  const rows = [
    ['Seedance 2.0', '32%', '#8b5cf6'],
    ['Seedance 2.0 Fast', '22%', '#ec4899'],
    ['Seedance 2.0 Mini', '20%', '#3b82f6'],
    ['TikTok 账号发布', '14%', '#f97316'],
    ['Seedance 2.0 Mini', '12%', '#ef4444'],
  ];

  return (
    <Card className="w-full max-w-sm p-5 h-[366px] flex flex-col">
      <h3 className="text-sm font-semibold text-white">工具使用占比</h3>
      <div className="flex min-h-[190px] flex-1 items-center justify-center">
        <div
          className="relative flex h-40 w-40 items-center justify-center rounded-full"
          style={{
            background: 'conic-gradient(#8b5cf6 0 32%, #ec4899 32% 54%, #3b82f6 54% 74%, #f97316 74% 88%, #ef4444 88% 100%)',
          }}
        >
          <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full border border-white/10 bg-[#0d0d13] shadow-inner">
            <span className="text-2xl font-bold text-white">128</span>
            <span className="text-[10px] text-gray-400">总生成次数</span>
          </div>
        </div>
      </div>
      <div className="space-y-1.5 mt-auto">
        {rows.map(([name, value, color]) => (
          <div key={name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span className="text-gray-400">{name}</span>
            </div>
            <span className="text-white">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SubscriptionCreditsPreviewCard() {
  const used = 1280;
  const total = 10000;
  const percent = Math.round((used / total) * 100);

  return (
    <div className="w-64 rounded-xl bg-white/5 border border-white/10 px-3 py-3 text-left">
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">Pro User</p>
            <p className="text-xs text-gray-500">专业版 · 年付</p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div>
          <p className="text-xs text-gray-500">当前积分</p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-xl font-bold text-white leading-tight">{used.toLocaleString()}</span>
            <span className="text-sm font-semibold text-gray-400 leading-tight">/ {total.toLocaleString()}</span>
          </div>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-pink-500 to-purple-500" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-black/20 border border-white/5 px-2 py-1.5">
          <p className="text-gray-500">积分重置</p>
          <p className="mt-0.5 text-gray-300">2026-07-03</p>
        </div>
        <div className="rounded-lg bg-black/20 border border-white/5 px-2 py-1.5">
          <p className="text-gray-500">到期日期</p>
          <p className="mt-0.5 text-gray-300">2027-06-18</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-gray-500">账户中心</span>
        <span className="text-purple-300">查看详情</span>
      </div>
    </div>
  );
}

function AccountCenterPreviewCard() {
  return (
    <div className="w-full max-w-3xl space-y-4">
      <PageHeader
        title="账户中心"
        subtitle="管理账户资料、订阅权益与积分流水"
        titleTone="solid"
        action={
          <Button size="md" icon={<ShieldCheck className="w-4 h-4" />}>
            进入管理后台
          </Button>
        }
      />
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-4 h-full flex flex-col">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">账户资料</p>
              <p className="text-xs text-gray-500">当前账户详细资料，请妥善保管。</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <Input label="用户名" value="Pro User" readOnly />
            <Input label="注册邮箱" value="pro.user@lindyson.ai" readOnly icon={<Mail className="w-4 h-4" />} />
          </div>
          <div className="mt-auto pt-4 grid grid-cols-2 gap-3">
            <Button size="md" variant="primary" icon={<Save className="w-3.5 h-3.5" />}>修改资料</Button>
            <Button size="md" variant="danger" icon={<LogOut className="w-3.5 h-3.5" />}>退出账号</Button>
          </div>
        </Card>

        <Card className="p-4 h-full flex flex-col">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <CreditCard className="w-4 h-4" />
            当前订阅
          </div>
          <p className="mt-3 text-sm font-semibold text-white">专业版 · 年付</p>
          <div className="mt-4 space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-2">
              <span className="text-gray-500">积分重置</span>
              <span className="text-gray-300">2026-07-03</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-2">
              <span className="text-gray-500">到期日期</span>
              <span className="text-gray-300">2027-06-18</span>
            </div>
          </div>
          <Button size="md" className="mt-auto w-full" iconRight={<ArrowRight className="w-3.5 h-3.5" />}>
            管理套餐
          </Button>
        </Card>

        <Card className="p-4 h-full flex flex-col">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Coins className="w-4 h-4" />
            积分概览
          </div>
          <p className="mt-3 text-2xl font-bold text-white">1,280 / 10,000</p>
          <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full w-[13%] rounded-full bg-gradient-to-r from-pink-500 to-purple-500" />
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[120px_80px_90px_1fr] px-3 py-2 text-xs text-gray-500 border-b border-white/10">
          <span>时间</span><span>类型</span><span>变动</span><span>来源</span>
        </div>
        <div className="grid grid-cols-[120px_80px_90px_1fr] px-3 py-2 text-xs items-center">
          <span className="text-gray-400">2026-06-18</span>
          <Badge variant="error">消耗</Badge>
          <span className="text-red-400 font-semibold">-80</span>
          <span className="text-gray-300 truncate">Seedance 2.0 视频生成</span>
        </div>
      </Card>
    </div>
  );
}

function SubscriptionPlanPreviewCard({ current = false, addon = false, enterprise = false }: { current?: boolean; addon?: boolean; enterprise?: boolean }) {
  const features = addon
    ? ['补充积分 30,000', '不改变套餐周期', '不改变积分重置日期', '优先消耗主套餐积分']
    : ['无限 AI 生成次数', '1080p 高清输出', '数字资产存储 100GB', '5 个 TikTok 账号'];

  return (
    <Card variant="interactive" accent={addon ? 'none' : enterprise ? 'orange' : 'violet'} className="w-64 p-5">
      <div className="flex h-10 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${addon || enterprise ? 'from-orange-500 to-red-600' : 'from-purple-600 to-blue-600'}`}>
            {addon ? <Coins className="w-5 h-5 text-white" /> : enterprise ? <Building2 className="w-5 h-5 text-white" /> : <Sparkles className="w-5 h-5 text-white" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{addon ? '积分加购包' : enterprise ? '企业专业版' : '运营专业版'}</p>
            <p className="truncate text-xs text-white">{addon ? 'Credits Add-on' : enterprise ? 'Enterprise Pro' : 'Pro'}</p>
          </div>
        </div>
        {!addon && (
          <span className={`flex-shrink-0 whitespace-nowrap rounded-full bg-gradient-to-r px-3 py-1 text-xs font-semibold text-white ${enterprise ? 'from-orange-500 to-red-600' : 'from-purple-600 to-blue-600'}`}>
            {enterprise ? '企业首选' : '最受欢迎'}
          </span>
        )}
      </div>
      <div className="mt-5">
        <div className="flex items-end gap-1">
          <span className="text-3xl font-bold text-white">{addon ? '¥49' : '¥19'}</span>
          <span className="pb-1 text-sm text-white">{addon ? '一次性' : '/月'}</span>
        </div>
        <p className="mt-1 text-xs text-white">
          {addon ? '一次性补充积分，不改变重置日期' : '按年计费 ¥228/年 · 月付原价 ¥348/年 · 省 34%'}
        </p>
        <p className="mt-3 text-xs leading-5 text-white">
          {addon ? '适合临时补充生成额度。' : '适合内容创作者与电商卖家。'}
        </p>
      </div>
      {!addon && (
        <div className={`mt-4 rounded-2xl border bg-gradient-to-r px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${enterprise ? 'border-orange-400/30 from-orange-500/15 via-amber-500/10 to-red-500/10' : 'border-fuchsia-400/30 from-fuchsia-500/15 via-purple-500/10 to-blue-500/10'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] ${enterprise ? 'text-orange-200' : 'text-fuchsia-200'}`}>
              <Coins className={`h-3.5 w-3.5 ${enterprise ? 'text-orange-300' : 'text-fuchsia-300'}`} />
              周期积分
            </span>
            <span className={`text-xl font-black tabular-nums ${enterprise ? 'text-orange-200' : 'text-fuchsia-200'}`}>30,000</span>
          </div>
        </div>
      )}
      <div className="mt-4 space-y-2">
        {features.map(feature => (
          <div key={feature} className="flex items-center gap-2 text-xs text-white">
            <span className="text-emerald-400">✓</span>
            <span>{feature}</span>
          </div>
        ))}
      </div>
      <Button
        className={`mt-5 w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white ${current ? 'opacity-60 cursor-default' : ''}`}
        disabled={current}
      >
        {current ? '当前套餐' : addon ? '购买加购包' : enterprise ? '选择企业版' : '升级套餐'}
      </Button>
    </Card>
  );
}

function AdminTablePreviewCard() {
  const rows = [
    ['Pro User', '专业版 · 年付', '1,280 / 10,000', '2026-07-03', '启用中', '2026-06-18 18:43'],
    ['Lena Store', '企业版 · 年付', '42,560 / 60,000', '2026-07-22', '启用中', '2026-06-18 17:09'],
  ];

  return (
    <Card className="w-full max-w-4xl overflow-hidden !border-white/[0.1] !bg-[#0e0f14] !backdrop-blur-none shadow-[0_22px_60px_rgba(0,0,0,0.28)]">
      <div className="max-w-full overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[1.2fr_1fr_.75fr_.9fr_.75fr_.95fr_120px] gap-4 border-b border-white/10 bg-[#08090d] px-4 py-3 text-xs text-gray-500">
            {['用户', '套餐', '积分', '套餐重置时间', '状态', '最近活跃', '操作'].map(header => (
              <div key={header} className="min-h-7 flex items-center">{header}</div>
            ))}
          </div>
          <div className="divide-y divide-white/[0.08]">
            {rows.map(row => (
              <div key={row[0]} className="grid grid-cols-[1.2fr_1fr_.75fr_.9fr_.75fr_.95fr_120px] gap-4 px-4 py-3 text-xs transition-colors duration-150 hover:bg-white/[0.025]">
                <div className="min-h-8 flex flex-col justify-center">
                  <span className="font-semibold text-[#f6f3ee]">{row[0]}</span>
                  <span className="text-gray-500">{row[0].toLowerCase().replace(' ', '.')}@lindyson.ai</span>
                </div>
                <div className="min-h-8 flex items-center text-gray-300">{row[1]}</div>
                <div className="min-h-8 flex items-center text-gray-300">{row[2]}</div>
                <div className="min-h-8 flex items-center text-gray-300">{row[3]}</div>
                <div className="min-h-8 flex items-center"><Badge variant="success" dot>{row[4]}</Badge></div>
                <div className="min-h-8 flex items-center text-gray-300">{row[5]}</div>
                <div className="min-h-8 flex items-center justify-end gap-2">
                  <Button size="sm" variant="secondary">调整积分</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.08] bg-[#0b0c12] px-4 py-3 text-xs text-gray-500">
            <span>共 2 条</span>
            <span>表格只在自身容器滚动</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function DesignSystem() {
  const [activeSection, setActiveSection] = useState<Section>('handoff');
  const [toggleA, setToggleA] = useState(false);
  const [toggleB, setToggleB] = useState(true);
  const [inputVal, setInputVal] = useState('');
  const [textVal, setTextVal] = useState('');
  const [tab1, setTab1] = useState('a');
  const [tab2, setTab2] = useState('video');
  const [assetTab, setAssetTab] = useState('video');
  const [selectExample, setSelectExample] = useState('all');
  const [monthExample, setMonthExample] = useState('2026-06');
  const [dateExample, setDateExample] = useState('2026-06-18');

  return (
    <div data-ui="design-system" className="flex h-full min-w-0 flex-col overflow-hidden md:flex-row">
      {/* Left nav */}
      <nav
        data-ui="design-system-nav"
        aria-label="设计规范章节"
        className="flex w-full flex-shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-4 py-3 md:w-48 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-b-0 md:border-r md:p-4"
      >
        <p className="hidden px-2 text-xs text-gray-500 md:mb-3 md:block">设计规范</p>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            data-state={activeSection === s.id ? 'active' : 'inactive'}
            aria-current={activeSection === s.id ? 'page' : undefined}
            onClick={() => setActiveSection(s.id)}
            className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-150 md:w-full ${activeSection === s.id ? 'border-violet-400/25 bg-violet-500/10 text-white' : 'border-transparent text-gray-400 hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white'}`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div data-ui="design-system-content" className="min-w-0 flex-1 space-y-10 overflow-y-auto p-4 sm:p-6">
        <PageHeader
          title="设计规范"
          subtitle="验证颜色、字体、按钮、卡片、表单、徽章、组件、布局、公开页与产品交接规范"
          titleTone="solid"
        />

        {/* Handoff */}
        {activeSection === 'handoff' && (
          <DSSection title="项目交接总览">
            <DSRow label="新 Codex 必读文档">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  {[
                    ['README.md', '轻量入口、运行命令和部署提醒。'],
                    ['LINDYSON_CODEX_HANDOFF.md', '唯一完整交接、产品规则和工程说明。'],
                    ['AGENTS.md', 'Codex 协作规则和本地部署提示。'],
                    ['ATTRIBUTIONS.md', '第三方资源与授权说明。'],
                  ].map(([title, desc]) => (
                    <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="font-semibold text-white">{title}</p>
                      <p className="mt-2 text-xs leading-5 text-gray-400">{desc}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </DSRow>
            <DSRow label="当前正确产品口径">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">三层入口</p>
                    <p className="mt-1 text-xs text-gray-400">公开官网、用户工作台和管理后台分离；工作台入口为 <code>/app</code>，后台入口为 <code>/admin</code>。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">真实 API 优先</p>
                    <p className="mt-1 text-xs text-gray-400">{PRODUCT_CAPABILITY_COPY.liveBoundary}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">后台为数据源</p>
                    <p className="mt-1 text-xs text-gray-400">订阅套餐、加购包、订单、发票和工单以 API 返回数据驱动用户端展示。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">管理员豁免</p>
                    <p className="mt-1 text-xs text-gray-400">{PRODUCT_CAPABILITIES.tiktokWorkspace.boundary}</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="共享能力状态">
              <div className="grid w-full max-w-4xl gap-3 md:grid-cols-2">
                {PRODUCT_CAPABILITY_LIST.map(capability => (
                  <Card key={capability.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">{capability.title}</p>
                        <p className="mt-2 text-xs leading-5 text-gray-400">{capability.description}</p>
                      </div>
                      <span className={`whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold ${capabilityStatusClasses[capability.status]}`}>
                        {CAPABILITY_STATUS_LABELS[capability.status]}
                      </span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-gray-300">{capability.boundary}</p>
                  </Card>
                ))}
              </div>
            </DSRow>
            <DSRow label="旧代码残留清单">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-3 text-xs md:grid-cols-3">
                  {[
                    '套餐中的 API 能力差异字段',
                    '素材额外说明旧字段和相关输入',
                    '数字资产大面积空状态卡片',
                    '把供应商额度页改回客户接口清单',
                    '不存在实现的预警开关或收件人',
                    '联系客服弹窗挂载在 sidebar 内部的旧实现',
                    'AI Studio 生成按钮出现“消耗”字样',
                    '用户端设计系统入口',
                    '裸原生 select 样式',
                    '功能开关卡片中的 sidebar 入口保留说明',
                  ].map(item => (
                    <div key={item} className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-100">
                      {item}
                    </div>
                  ))}
                </div>
              </Card>
            </DSRow>
            <DSRow label="交付检查">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">构建检查</p>
                    <p className="mt-1 text-xs text-gray-400">每次代码改动后运行 <code>npm run build</code>。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">双端验证</p>
                    <p className="mt-1 text-xs text-gray-400">共享数据变更要同时检查用户端与管理后台。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">规范同步</p>
                    <p className="mt-1 text-xs text-gray-400">重要产品规则变更后同步更新本页面和 <code>LINDYSON_CODEX_HANDOFF.md</code>。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">部署约束</p>
                    <p className="mt-1 text-xs text-gray-400">涉及 VPS 同步或部署前，必须先询问用户。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
          </DSSection>
        )}

        {/* Public pages */}
        {activeSection === 'public' && (
          <DSSection title="官网首页与登录注册规范">
            <DSRow label="路由入口">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3 lg:grid-cols-7">
                  {[
                    ['/', '公开产品落地页首页，不直接进入工作台。'],
                    ['/login', '单框居中登录页，登录成功进入 /app。'],
                    ['/register', '独立注册页，包含用户名、邮箱验证码、密码和确认密码。'],
                    ['/reset-password', '邮件链接进入的新密码设置页。'],
                    ['/app', '现有用户端工作台，默认仪表盘。'],
                    ['/admin', '真实管理后台入口，仅管理员账号可访问。'],
                    ['其他路径', '显示极简 404，只提供返回首页按钮。'],
                  ].map(([title, desc]) => (
                    <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="font-semibold text-white">{title}</p>
                      <p className="mt-2 text-xs leading-5 text-gray-400">{desc}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </DSRow>
            <DSRow label="落地页结构">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <Sparkles className="mb-2 h-5 w-5 text-purple-300" />
                    <p className="font-semibold text-white">首屏 Hero</p>
                    <p className="mt-1 text-xs text-gray-400">主标题聚焦“{PRODUCT_BRAND.landingHeadline}”，主按钮进入登录页。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">销售内容</p>
                    <p className="mt-1 text-xs text-gray-400">顺序固定为 Hero、沉浸式创作过程、三项核心能力、正式套餐、FAQ 和末尾 CTA；不出现管理端或运营对账内容。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">视觉限制</p>
                    <p className="mt-1 text-xs text-gray-400">允许克制的 hero eyebrow；不使用真实人物照片、浅色背景、夸张装饰球或虚假客户 Logo。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">CTA 行为</p>
                    <p className="mt-1 text-xs text-gray-400">主按钮统一使用“开始创作”并跳转 <code>/login</code>；不使用“免费体验”，避免与正式套餐状态冲突。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="SEO 与真实边界">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <p className="font-semibold text-white">双 HTML 壳</p>
                    <p className="mt-1 text-xs text-gray-400"><code>/</code> 使用含静态营销正文的 <code>index.html</code> 并允许索引；工作台、后台、鉴权与未知路由回退到 <code>app.html</code> 并禁止索引。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">单一文案来源</p>
                    <p className="mt-1 text-xs text-gray-400">React 首页和构建期静态快照共同读取 <code>landingContent.ts</code>；产品真实能力状态继续由 <code>capabilities.ts</code> 独立维护。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">上线门槛</p>
                    <p className="mt-1 text-xs text-gray-400">首页图片能力使用 Seedream 5.0 Pro；TikTok 仍只是发布工作区与预览，真实发布接口尚未接入。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="登录 / 注册页面">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">单框极简</p>
                    <p className="mt-1 text-xs text-gray-400">登录页只保留居中登录框，不出现右侧简介面板，也不使用登录/注册 Tab。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">登录字段</p>
                    <p className="mt-1 text-xs text-gray-400">邮箱、密码、忘记密码入口和登录按钮；成功后进入 <code>/app</code>。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">注册入口</p>
                    <p className="mt-1 text-xs text-gray-400">登录框底部文字链接进入 <code>/register</code>，字段为用户名、邮箱、邮箱验证码、密码和确认密码。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">注册规则</p>
                    <p className="mt-1 text-xs text-gray-400">用户名允许重复，邮箱是唯一登录入口；注册前必须先通过后端邮件验证码，重新发送按钮有 60 秒倒计时。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">找回密码</p>
                    <p className="mt-1 text-xs text-gray-400">登录页弹窗请求后端发送 Resend 重置链接，链接进入 <code>/reset-password</code> 设置新密码。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="公开页视觉">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">电影感近黑体系</p>
                    <p className="mt-1 text-xs text-gray-400">画布、区块和浮层使用近黑分层；暖白标题承担层级，粉紫蓝只用于 CTA、进度和少量焦点。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">文案可信</p>
                    <p className="mt-1 text-xs text-gray-400">可以展示流程、能力和产品规则，不写无法验证的客户名称、Logo 或商业数据。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">响应式</p>
                    <p className="mt-1 text-xs text-gray-400">桌面双列增强产品感，窄屏单列堆叠，按钮和卡片文字不得溢出。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="404 页面">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">极简内容</p>
                    <p className="mt-1 text-xs text-gray-400">只显示 Lindyson AI、404、页面错误。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">返回操作</p>
                    <p className="mt-1 text-xs text-gray-400">只提供一个粉紫主按钮：返回首页。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">表达限制</p>
                    <p className="mt-1 text-xs text-gray-400">不展示错误原因、路径信息或其他说明。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
          </DSSection>
        )}

        {/* Colors */}
        {activeSection === 'colors' && (
          <DSSection title="颜色系统">
            <DSRow label="品牌强调色（仅 CTA / 进度 / 焦点）">
              {[
                ['from-purple-600 to-blue-600',   'Logo / 官网品牌'],
                ['from-pink-600 to-purple-600',    '官网 / 用户端 CTA'],
                ['from-orange-500 to-red-600',     '套餐身份'],
                ['from-blue-600 to-cyan-600',      '用户端局部强调'],
              ].map(([g, l]) => (
                <div key={g} className="text-center space-y-1.5">
                  <div className={`w-20 h-10 rounded-xl bg-gradient-to-r ${g}`} />
                  <p className="text-xs text-gray-500">{l}</p>
                </div>
              ))}
            </DSRow>
            <DSRow label="用户端语义表面 (Product Surfaces)">
              {[
                ['bg-[#050507]', 'Canvas'],
                ['bg-[#08080c]', 'Base / Sidebar'],
                ['bg-[#0d0d13]', 'Card / Raised'],
                ['bg-[#09090f]', 'Chart Plot'],
                ['bg-[#0b0a12]', 'Floating'],
              ].map(([cls, l]) => (
                <div key={cls} className="text-center space-y-1.5">
                  <div className={`w-20 h-10 rounded-xl border border-white/10 ${cls}`} />
                  <p className="text-xs text-gray-500 font-mono">{l}</p>
                </div>
              ))}
            </DSRow>
            <DSRow label="状态色 (Status)">
              {[
                ['text-green-400 bg-green-500/15', '成功'],
                ['text-yellow-400 bg-yellow-500/15', '警告'],
                ['text-red-400 bg-red-500/15', '错误'],
                ['text-purple-400 bg-purple-500/20', '强调'],
                ['text-gray-400 bg-white/10', '默认'],
              ].map(([cls, l]) => (
                <div key={l} className={`px-3 py-1.5 rounded-full text-xs ${cls}`}>{l}</div>
              ))}
            </DSRow>
            <DSRow label="边框 (Borders)">
              {[
                ['border-white/10',       '默认'],
                ['border-white/20',       '悬停'],
                ['border-purple-500/30',  '激活'],
                ['border-white/15 border-dashed', '虚线'],
              ].map(([cls, l]) => (
                <div key={l} className="text-center space-y-1.5">
                  <div className={`w-20 h-10 rounded-xl border-2 ${cls}`} />
                  <p className="text-xs text-gray-500">{l}</p>
                </div>
              ))}
            </DSRow>
            <DSRow label="滚动条 (Scrollbar)">
              <div className="w-full max-w-sm h-28 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
                <p className="text-white font-medium mb-2">用户端透明轨道 + 石墨滑块</p>
                <p>用户端默认使用低对比暖灰滑块，hover 才轻微偏紫。</p>
                <p className="mt-3">Landing、Product 与 Admin 必须使用各自主题作用域；公开页可保留营销表现，管理后台统一使用石墨实色表面，二者都不能反向污染生产工作台。</p>
              </div>
            </DSRow>
          </DSSection>
        )}

        {/* Typography */}
        {activeSection === 'typography' && (
          <DSSection title="字体系统">
            <DSRow label="用户端页面标题：30–32px / 暖白 / 紧字距">
              <div>
                <p className="mb-3 text-[10px] font-bold tracking-[0.26em] text-violet-300">CREATIVE WORKSPACE</p>
                <h1 className="mb-2 text-[2rem] font-extrabold tracking-[-0.03em] text-[#f6f3ee]">
                页面标题 Page Title
                </h1>
              </div>
            </DSRow>
            <DSRow label="工作区小标题 text-gray-400">
              <p className="text-gray-400">说明当前页面核心用途，不使用 text-sm，卡片内辅助说明除外。</p>
            </DSRow>
            <DSRow label="区块标题 text-base font-semibold">
              <h3 className="text-base font-semibold text-white">区块标题 Section Header</h3>
            </DSRow>
            <DSRow label="正文 text-sm">
              <p className="text-sm text-white">正文内容 Body Text</p>
            </DSRow>
            <DSRow label="辅助 text-xs text-gray-400">
              <p className="text-xs text-gray-400">辅助说明文字 Helper Text</p>
            </DSRow>
            <DSRow label="GradientText 仅用于 Landing 品牌强调；用户端 PageHeader 禁用">
              <GradientText as="h2" className="text-2xl font-bold" preset="primary">主色渐变标题</GradientText>
            </DSRow>
          </DSSection>
        )}

        {/* Buttons */}
        {activeSection === 'buttons' && (
          <DSSection title="按钮组件 Button">
            <DSRow label="variant">
              <Button variant="primary">主要按钮</Button>
              <Button variant="pink">粉紫按钮</Button>
              <Button variant="secondary">次要按钮</Button>
              <Button variant="ghost">幽灵按钮</Button>
              <Button variant="danger">危险按钮</Button>
            </DSRow>
            <DSRow label="size">
              <Button size="sm">小号 sm</Button>
              <Button size="md">中号 md</Button>
              <Button size="lg">大号 lg (全宽)</Button>
            </DSRow>
            <DSRow label="states">
              <Button loading>加载中</Button>
              <Button disabled>禁用状态</Button>
              <Button icon={<Sparkles className="w-4 h-4" />}>带图标</Button>
              <Button iconRight={<Zap className="w-4 h-4" />}>右侧图标</Button>
            </DSRow>
          </DSSection>
        )}

        {/* Cards */}
        {activeSection === 'cards' && (
          <DSSection title="卡片组件 Card">
            <DSRow label="variant=default (基础卡片)">
              <Card className="w-64 p-5">
                <p className="text-sm text-white">默认卡片内容</p>
                <p className="mt-1 text-xs text-gray-400">具体表面由 Landing、Product、Admin 主题作用域决定；后台不得回退为统一玻璃卡片。</p>
              </Card>
              <Card className="w-64" hover>
                <CardHeader><span className="text-sm font-medium text-white">带 Header</span></CardHeader>
                <CardBody><p className="text-xs text-gray-400">CardHeader + CardBody 组合</p></CardBody>
              </Card>
            </DSRow>
            <DSRow label="用户端语义表面">
              <Card variant="raised" className="w-64 p-5">
                <p className="text-sm font-semibold text-white">Raised 主面板</p>
                <p className="mt-1 text-xs text-gray-400">近黑实色、顶部高光与柔和投影</p>
              </Card>
              <Card variant="interactive" className="w-64 p-5">
                <p className="text-sm font-semibold text-white">Interactive 交互卡</p>
                <p className="mt-1 text-xs text-gray-400">悬停最多上移 1–2px</p>
              </Card>
              <Card variant="media" className="w-64 p-5">
                <p className="text-sm font-semibold text-white">Media 内容舞台</p>
                <p className="mt-1 text-xs text-gray-400">只承载真实用户内容或预览</p>
              </Card>
            </DSRow>
            <DSRow label="accent=局部彩釉（与 variant 正交）">
              <Card variant="raised" accent="violet" className="w-52 p-5">
                <p className="text-sm font-semibold text-white">Violet / Blue / Pink</p>
                <p className="mt-1 text-xs text-gray-400">身份、选择与结果表面</p>
              </Card>
              <Card variant="raised" accent="slate" className="w-52 p-5">
                <p className="text-sm font-semibold text-white">Slate</p>
                <p className="mt-1 text-xs text-gray-400">未接真实能力或中性状态</p>
              </Card>
              <Card variant="raised" accent="warm" className="w-52 p-5">
                <p className="text-sm font-semibold text-white">Warm</p>
                <p className="mt-1 text-xs text-gray-400">公告等低干扰信息流</p>
              </Card>
            </DSRow>
            <DSRow label="variant=modal (弹窗)">
              <Card variant="modal" className="w-64 p-5">
                <p className="text-sm text-white">弹窗卡片</p>
                <p className="text-xs text-gray-400 mt-1">用户端浮层 #0b0a12 + 必要模糊</p>
              </Card>
            </DSRow>
            <DSRow label="variant=dropdown (下拉)">
              <Card variant="dropdown" className="w-48 py-2">
                {['选项一', '选项二', '选项三'].map(o => (
                  <div key={o} className="px-4 py-2 text-sm text-gray-300 hover:bg-white/5 cursor-pointer">{o}</div>
                ))}
              </Card>
            </DSRow>
            <DSRow label="StatCard 统计卡片">
              <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                <StatCard tone="product" accent="violet" label="AI生成次数" value="5,678" change="+34%" icon={<Sparkles className="w-5 h-5" />} gradient="from-fuchsia-600 to-violet-600" />
                <StatCard tone="product" accent="blue" label="AI视频生成" value="1,234" change="+12%" icon={<Video className="w-5 h-5" />} gradient="from-violet-600 to-blue-600" />
                <StatCard tone="product" accent="pink" label="AI图片生成" value="856" change="+25%" icon={<Video className="w-5 h-5" />} gradient="from-fuchsia-600 to-violet-600" />
                <StatCard tone="product" accent="slate" label="已授权TikTok账号" value="0" icon={<Users className="w-5 h-5" />} gradient="from-violet-600 to-blue-600" />
              </div>
            </DSRow>
          </DSSection>
        )}

        {/* Subscription */}
        {activeSection === 'subscription' && (
          <DSSection title="订阅套餐规范">
            <DSRow label="月付 / 年付 Toggle">
              <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                <button className="rounded-full px-3 py-1.5 text-xs text-gray-400">月付</button>
                <button className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-600 to-purple-600 px-3 py-1.5 text-xs font-semibold text-white">
                  年付
                  <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">年付更优惠</span>
                </button>
              </div>
              <span className="text-xs text-gray-400">默认选中年付；选中态统一使用粉紫主按钮色，并使用“年付更优惠”避免承诺固定折扣。</span>
            </DSRow>
            <DSRow label="主套餐与加购包卡片">
              <div className="flex flex-wrap gap-4">
                <SubscriptionPlanPreviewCard current />
                <SubscriptionPlanPreviewCard enterprise />
                <SubscriptionPlanPreviewCard addon />
              </div>
            </DSRow>
            <DSRow label="订阅页展示规则">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">近黑交互表面</p>
                    <p className="mt-1 text-xs text-gray-400">首页与订阅页共享主套餐卡片：运营套餐统一使用紫色底色渐变，企业套餐统一使用橙色底色渐变，加购包保持中性。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">粉紫 CTA</p>
                    <p className="mt-1 text-xs text-gray-400">所有订阅按钮使用粉紫渐变；当前套餐保持禁用但视觉一致。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">白色文案</p>
                    <p className="mt-1 text-xs text-gray-400">简介、按年计费、功能权益均为纯白；周期积分跟随运营粉紫或企业橙色身份色，功能可用性由图标表达。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">加购包分区</p>
                    <p className="mt-1 text-xs text-gray-400">主套餐与积分加购包之间使用分割线；加购包不参与月付/年付切换，也不显示卡片右上角推荐标签。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="年付折扣计算">
              <code className="rounded-lg bg-white/5 px-3 py-2 text-xs text-purple-300">
                {'省 x% = Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100)'}
              </code>
              <span className="text-xs text-gray-400">付费主套餐年付文案必须展示年付总价、月付原价年化价格和折扣；年付月均价按人民币元四舍五入且不保留小数，实际年付金额保持不变；免费版不显示无意义折扣。</span>
            </DSRow>
            <DSRow label="计费边界">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <p className="font-semibold text-white">主套餐</p>
                    <p className="mt-1 text-xs text-gray-400">只有月付 / 年付，周期积分按套餐周期重置。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">积分加购包</p>
                    <p className="mt-1 text-xs text-gray-400">一次性补充积分，不改变套餐周期和积分重置日期。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">消耗顺序</p>
                    <p className="mt-1 text-xs text-gray-400">优先消耗主套餐积分，再消耗加购包积分。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="常见问题 FAQ">
              <Card className="w-full max-w-3xl p-5">
                <div className="space-y-4">
                  <div>
                    <p className="text-center text-2xl font-bold text-white">常见问题</p>
                    <p className="mt-2 text-center text-xs text-gray-400">放在主套餐与加购包之后，作为订阅页内容收尾。</p>
                  </div>
                  <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
                    {[
                      ['未用完的积分会继续留到下个月吗？','不会，主套餐积分会在每个结算周期开始时重置。'],
                      ['购买后可以退款吗？','付款成功且套餐正式生效后无法退款，请谨慎购买。'],
                    ].map(([question,answer]) => (
                      <details key={question} className="group open:bg-white/[0.025]">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-white marker:hidden [&::-webkit-details-marker]:hidden">
                          {question}
                          <ChevronDown className="h-4 w-4 flex-shrink-0 text-purple-300 transition-transform group-open:rotate-180" />
                        </summary>
                        <p className="px-5 pb-5 pr-12 text-sm leading-6 text-gray-300">{answer}</p>
                      </details>
                    ))}
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-purple-500/20 bg-purple-500/10 px-3 py-2 text-xs text-purple-200">
                  FAQ 默认全部折叠，使用原生 details/summary 与旋转箭头；保留键盘操作，不使用 Q/A 标识、浅色卡片或额外底部说明。
                </div>
              </Card>
            </DSRow>
          </DSSection>
        )}

        {/* Forms */}
        {activeSection === 'forms' && (
          <DSSection title="表单组件 Input / Textarea">
            <DSRow label="Input 基础">
              <div className="w-72 space-y-3">
                <Input placeholder="基础输入框" />
                <Input label="带标签" placeholder="有标签的输入框" />
                <Input label="带图标" icon={<Star className="w-4 h-4" />} placeholder="带前置图标" />
                <Input label="带计数" suffix="0 / 30" placeholder="带后置内容" />
                <Input label="错误状态" error="请输入有效内容" value={inputVal} onChange={e => setInputVal(e.target.value)} />
              </div>
            </DSRow>
            <DSRow label="Select / 日期选择">
              <div className="grid w-full max-w-3xl gap-4 md:grid-cols-3">
                <Select
                  label="模型"
                  value={selectExample}
                  options={[
                    { value: 'all', label: '全部模型' },
                    { value: 'standard', label: 'Seedance 2.0' },
                    { value: 'fast', label: 'Seedance 2.0 Fast' },
                    { value: 'mini', label: 'Seedance 2.0 Mini' },
                  ]}
                  onValueChange={setSelectExample}
                />
                <DatePicker mode="month" label="月份" value={monthExample} max="2026-07" onValueChange={setMonthExample} />
                <DatePicker mode="date" label="日期" value={dateExample} max="2026-07-14" onValueChange={setDateExample} />
              </div>
              <p className="w-full text-xs text-gray-400">下拉、月份和日期面板统一使用暗色 Portal 浮层、紫色选中态和完整键盘操作，不使用浏览器原生系统弹层。</p>
            </DSRow>
            <DSRow label="Textarea">
              <div className="w-96 space-y-3">
                <Textarea placeholder="多行文本输入" rows={3} />
                <Textarea label="带标签和计数" placeholder="请输入内容..." rows={4} counter={{ current: textVal.length, max: 4000 }} value={textVal} onChange={e => setTextVal(e.target.value)} />
              </div>
            </DSRow>
            <DSRow label="Toggle 开关">
              <Toggle enabled={toggleA} onChange={setToggleA} label="关闭状态" />
              <Toggle enabled={toggleB} onChange={setToggleB} label="开启状态" />
              <Toggle enabled={toggleA} onChange={setToggleA} size="sm" label="小号 sm" />
              <span className="text-xs text-gray-400">圆点开启/关闭状态左右留白必须对称；中号使用 40×24，小号使用 32×20。</span>
            </DSRow>
          </DSSection>
        )}

        {/* Badges */}
        {activeSection === 'badges' && (
          <DSSection title="徽章组件 Badge">
            <DSRow label="variant">
              <Badge variant="default">默认</Badge>
              <Badge variant="success">成功</Badge>
              <Badge variant="warning">警告</Badge>
              <Badge variant="error">错误</Badge>
              <Badge variant="purple">紫色</Badge>
              <Badge variant="pink">粉色</Badge>
              <Badge variant="orange">橙色</Badge>
              <Badge variant="blue">蓝色</Badge>
            </DSRow>
            <DSRow label="dot 小圆点">
              <Badge variant="success" dot>已完成</Badge>
              <Badge variant="warning" dot>生成中</Badge>
              <Badge variant="purple" dot>分析中</Badge>
              <Badge variant="error" dot>失败</Badge>
              <span className="text-xs text-gray-400">“分析中”统一使用紫色，不使用蓝色或黄色。</span>
            </DSRow>
          </DSSection>
        )}

        {/* Components */}
        {activeSection === 'components' && (
          <DSSection title="复合组件">
            <DSRow label="TabBar segment 分段">
              <TabBar
                tabs={[{ id: 'video', label: '视频生成', icon: <Video className="w-4 h-4" /> }]}
                active={tab2} onChange={setTab2} variant="segment" tone="product"
              />
            </DSRow>
            <DSRow label="TabBar pill 胶囊">
              <TabBar
                tabs={[{ id: 'a', label: 'AI视频' }, { id: 'b', label: 'AI图片' }, { id: 'c', label: '已上传视频' }, { id: 'd', label: '已上传图片' }]}
                active={tab1} onChange={setTab1} variant="pill" tone="product"
              />
            </DSRow>
            <DSRow label="SectionHeader">
              <div className="w-full max-w-lg">
                <SectionHeader title="生成队列" icon={<Video className="w-4 h-4 text-purple-400" />} action={<span className="text-xs text-gray-500">3 个任务</span>} />
              </div>
            </DSRow>
            <DSRow label="PageHeader">
              <div className="w-full max-w-lg">
                <PageHeader eyebrow="ASSET LIBRARY" title="数字资产" titleTone="solid" subtitle="管理你的视频、图片、音频与文件夹资产" />
              </div>
            </DSRow>
            <DSRow label="UploadZone">
              <div className="w-72">
                <UploadZone title="图片 / 视频 / 音频" subtitle="上限由所选模型能力决定；Seedance 2.5 最多 50 项多模态参考" height="h-32" />
              </div>
            </DSRow>
            <DSRow label="QueueItem">
              <div className="w-72 space-y-2">
                <QueueItem id="1" thumbnail="https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=200&q=80" title="产品发布宣传片" meta="Seedance 2.0" time="14:32" status="done" onDownload={() => {}} onShare={() => {}} />
                <QueueItem id="2" thumbnail={null} thumbnailIcon={<Video className="w-5 h-5 text-gray-600" />} title="品牌故事视频" meta="Seedance 2.0 Fast" time="14:35" status="generating" />
                <QueueItem id="3" thumbnail={null} thumbnailIcon={<Video className="w-5 h-5 text-gray-600" />} title="社交短片" meta="Seedance 2.0 Mini" time="14:36" status="queued" />
              </div>
            </DSRow>
            <DSRow label="EmptyState">
              <div className="w-64 bg-white/5 rounded-2xl">
                <EmptyState icon={<Video className="w-10 h-10" />} title="暂无生成任务" subtitle="点击生成视频后将在此显示" />
              </div>
            </DSRow>
          </DSSection>
        )}

        {/* Assets */}
        {activeSection === 'assets' && (
          <DSSection title="素材资产规范">
            <DSRow label="素材分类筛选">
              <AssetCategoryTabsPreview active={assetTab} onChange={setAssetTab} />
            </DSRow>
            <DSRow label="文件夹与素材双栏">
              <AssetLibraryLayoutPreview />
            </DSRow>
            <DSRow label="资产汇总">
              <div className="grid w-full max-w-4xl grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard tone="product" accent="violet" label="全部资产" value="42" icon={<FolderOpen className="h-5 w-5" />} gradient="from-violet-600 to-fuchsia-600" />
                <StatCard tone="product" accent="blue" label="视频文件" value="5" icon={<Video className="h-5 w-5" />} gradient="from-blue-600 to-cyan-600" />
                <StatCard tone="product" accent="pink" label="图片文件" value="37" icon={<ImageIcon className="h-5 w-5" />} gradient="from-pink-600 to-fuchsia-600" />
                <StatCard tone="product" accent="slate" label="音频文件" value="0" icon={<Headphones className="h-5 w-5" />} gradient="from-cyan-600 to-blue-600" />
              </div>
            </DSRow>
            <DSRow label="文件夹规则">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-5">
                  <div>
                    <p className="font-semibold text-white">单层文件夹</p>
                    <p className="mt-1 text-xs text-gray-400">文件夹内不再创建子文件夹。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">左右分栏</p>
                    <p className="mt-1 text-xs text-gray-400">1280px 起桌面左右分栏；平板用侧边抽屉，手机用底部面板。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">主目录真实</p>
                    <p className="mt-1 text-xs text-gray-400">每个来源使用真实系统目录，不制造虚拟目录 ID。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">安全删除</p>
                    <p className="mt-1 text-xs text-gray-400">非空目录默认把素材移回主目录，永久删除必须强确认。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">右对齐数量</p>
                    <p className="mt-1 text-xs text-gray-400">主目录保留菜单列占位，数量与普通目录使用同一右边缘。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="素材操作反馈">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <p className="font-semibold text-white">工具栏操作</p>
                    <p className="mt-1 text-xs text-gray-400">页头不放新建或上传；批量操作在左、上传素材在右。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">绿色下载图标</p>
                    <p className="mt-1 text-xs text-gray-400">仅表示服务端已成功签发下载并发起浏览器下载，不表示文件已保存到本机。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">紧凑菜单</p>
                    <p className="mt-1 text-xs text-gray-400">文件夹和素材菜单固定 176px；窄屏向视口内收敛。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="批量操作">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="font-semibold text-white">当前页选择</p>
                    <p className="mt-1 text-xs text-gray-400">支持逐项和选择本页，不跨页保留隐藏选择。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">批量移动</p>
                    <p className="mt-1 text-xs text-gray-400">目标仅限同来源主目录或已有目录，原目录不显示。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">批量删除</p>
                    <p className="mt-1 text-xs text-gray-400">删除前必须二次确认，并提示不可撤回。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">不做下载</p>
                    <p className="mt-1 text-xs text-gray-400">批量栏不提供下载入口；单素材详情保留下载。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="卡片常驻操作">
              <Card className="w-full max-w-4xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">真实预览</p>
                    <p className="mt-1 text-xs text-gray-400">点击卡片主体打开现有素材预览弹窗，加载期间给出卡内反馈。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">统一下载</p>
                    <p className="mt-1 text-xs text-gray-400">卡片、详情弹窗和 AI Studio 队列下载复用同一个下载函数。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">批量操作避让</p>
                    <p className="mt-1 text-xs text-gray-400">批量模式隐藏单项操作，卡片主体改为带状态的选择按钮。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">触控与键盘</p>
                    <p className="mt-1 text-xs text-gray-400">下载和更多菜单始终可达，不把任何能力只放在 hover 中。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="素材详情弹窗">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="font-semibold text-white">近全屏弹窗</p>
                    <p className="mt-1 text-xs text-gray-400">左侧黑底大预览，右侧信息栏，不使用右侧滑出面板。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">比例预览</p>
                    <p className="mt-1 text-xs text-gray-400">视频按 9:16/16:9，图片按生成比例或原始尺寸展示。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">生成信息</p>
                    <p className="mt-1 text-xs text-gray-400">AI 视频与图片都展示模型、配置、提示词和参考素材；{PRODUCT_CAPABILITIES.seedreamImage.boundary}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">字段精简</p>
                    <p className="mt-1 text-xs text-gray-400">只保留名称、文件夹和基础信息，不提供额外说明字段。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
          </DSSection>
        )}

        {/* Charts */}
        {activeSection === 'charts' && (
          <DSSection title="数据图表规范">
            <DSRow label="工具使用占比：Donut + 中心总数 + 降序图例">
              <PiePreviewCard />
            </DSRow>
            <DSRow label="图表规则">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <PieChart className="w-5 h-5 text-purple-300 mb-2" />
                    <p className="font-semibold text-white">中心摘要</p>
                    <p className="mt-1 text-xs text-gray-400">使用 Donut，并在中心显示总生成次数与口径。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">按比例排序</p>
                    <p className="mt-1 text-xs text-gray-400">图例和扇区数据从高到低排列。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">同高对齐</p>
                    <p className="mt-1 text-xs text-gray-400">图表卡片与相邻趋势卡片保持同高。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">轴向留白</p>
                    <p className="mt-1 text-xs text-gray-400">X 轴标签完整显示，只保留最小可读留白。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
          </DSSection>
        )}

        {/* Account */}
        {activeSection === 'account' && (
          <DSSection title="账户中心规范">
            <DSRow label="页面结构">
              <AccountCenterPreviewCard />
            </DSRow>
            <DSRow label="用户资料与订阅">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="font-semibold text-white">资料卡</p>
                    <p className="mt-1 text-xs text-gray-400">用户名可编辑，注册邮箱只读展示。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">订阅卡</p>
                    <p className="mt-1 text-xs text-gray-400">展示套餐、周期、重置日期与到期日期。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">积分卡</p>
                    <p className="mt-1 text-xs text-gray-400">展示当前积分 / 周期总额度和粉紫进度条。</p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-purple-500/20 bg-purple-500/10 px-3 py-2 text-xs text-purple-200">
                  管理员账号在页面右上角显示“进入管理后台”，普通用户不显示该入口。
                </div>
              </Card>
            </DSRow>
            <DSRow label="积分流水">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <ReceiptText className="w-5 h-5 text-purple-300 mb-2" />
                    <p className="font-semibold text-white">固定字段</p>
                    <p className="mt-1 text-xs text-gray-400">时间、类型、积分变动、余额、来源、备注。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">筛选分页</p>
                    <p className="mt-1 text-xs text-gray-400">全部 / 获得 / 消耗 / 退回，单页 20 条；本页数量与共计数量分开表达。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">颜色规则</p>
                    <p className="mt-1 text-xs text-gray-400">正数绿色，负数红色，退回使用蓝色标签。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">备注文案</p>
                    <p className="mt-1 text-xs text-gray-400">采用“发生了什么 + 积分结果”；不得展示供应商、支付适配器、Request ID 或英文底层错误。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="全站轻量分页">
              <Card className="w-full max-w-2xl p-5">
                <div className="space-y-4">
                  <div>
                    <p className="font-semibold text-white">本次浏览快照精准</p>
                    <p className="mt-1 text-xs leading-5 text-gray-400">
                      用户端与管理后台统一使用透明底色的轻量分页；桌面按钮 32×32px、触屏 44×44px，当前页亮色、总页数灰色。保留中文无障碍名称、悬停提示和页码播报。
                    </p>
                  </div>
                  <CursorPagination
                    pagination={{
                      limit: 7,
                      position: 'next',
                      hasPrevious: true,
                      hasNext: true,
                      previousCursor: 'design-previous',
                      nextCursor: 'design-next',
                      currentPage: 3,
                      totalPages: 6,
                      totalItems: 41,
                      snapshotCursor: 'design-snapshot',
                    }}
                    onNavigate={() => undefined}
                    label="精准分页设计示例"
                  />
                  <p className="text-xs leading-5 text-gray-500">
                    空结果沿用原空状态；单页隐藏导航，默认显示总数。页脚按容器宽度适配：不足 420px 时上下排列、导航居中；客服工单隐藏数量文字，仅保留居中导航。加载时保留原列表与页码，禁用重复点击。
                  </p>
                </div>
              </Card>
            </DSRow>
          </DSSection>
        )}

        {/* Admin */}
        {activeSection === 'admin' && (
          <DSSection title="管理后台视觉与业务规范">
            <DSRow label="admin-shell 视觉方向">
              <Card className="w-full max-w-5xl overflow-hidden !border-white/[0.1] !bg-[#0e0f14] !backdrop-blur-none shadow-[0_22px_60px_rgba(0,0,0,0.28)]">
                <div className="border-b border-white/[0.08] bg-[#090a0e] p-5 sm:p-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300">OPERATIONS CONTROL</p>
                  <h3 className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-[#f6f3ee]">安静、可信赖的运营控制台</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                    管理后台使用独立 <code>admin-shell</code> 作用域。它继承近黑层级和暖白排版，但比用户端更中性、更高密度；不复制 Landing 的营销叙事、巨型留白或大面积品牌光效。
                  </p>
                </div>
                <div className="grid gap-px bg-white/[0.08] sm:grid-cols-3">
                  {[
                    ['实色优先', '卡片、表格、图表和表单使用石墨实色；只有菜单与弹窗等真实浮层使用 blur。'],
                    ['颜色有因', '紫色只用于品牌、主操作、焦点与选中；主操作允许 #7c3aed → #8b5cf6 同色相轻微明度过渡，状态色只表达真实业务状态。'],
                    ['密度可控', '标题克制、操作靠近对象；超宽屏限宽，窄屏只让数据表在自身容器滚动。'],
                  ].map(([title, copy]) => (
                    <div key={title} className="bg-[#0e0f14] p-5">
                      <p className="text-sm font-semibold text-[#f6f3ee]">{title}</p>
                      <p className="mt-2 text-xs leading-5 text-white/50">{copy}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </DSRow>
            <DSRow label="后台精准分页边界">
              <Card className="w-full max-w-5xl !border-white/[0.1] !bg-[#0e0f14] !backdrop-blur-none p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div className="rounded-xl border border-white/[0.08] bg-[#090a0f] p-4">
                    <p className="font-semibold text-[#f6f3ee]">29 个分页表</p>
                    <p className="mt-2 text-xs leading-5 text-white/50">
                      19 个服务端表使用 exact snapshot；10 个本地表按本次已加载数组精确计算。底栏统一写作“本页 N 条 · 共 M 条”，同页多表使用独立中文导航名称。
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-[#090a0f] p-4">
                    <p className="font-semibold text-[#f6f3ee]">服务端一致性</p>
                    <p className="mt-2 text-xs leading-5 text-white/50">
                      核心与成本端点分别由 Migration 079 / 080 支持；快照绑定管理员管理权限域。版本失效返回 409 并自动回首页，SQL 继续使用键集查询，禁止 OFFSET。
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-4">
                    <p className="font-semibold text-amber-100">真人容量例外</p>
                    <p className="mt-2 text-xs leading-5 text-amber-100/60">
                      3 个本地表受接口 1000 / 500 / 500 安全上限约束，页码只对已返回子集精准；页面总量提示继续承担全局口径。Plans 不分页。
                    </p>
                  </div>
                </div>
                <div className="mt-5">
                  <CursorPagination
                    pagination={{
                      limit: 20,
                      position: 'next',
                      hasPrevious: true,
                      hasNext: true,
                      previousCursor: 'admin-design-previous',
                      nextCursor: 'admin-design-next',
                      currentPage: 3,
                      totalPages: 6,
                      totalItems: 112,
                      snapshotCursor: 'admin-design-snapshot',
                    }}
                    onNavigate={() => undefined}
                    label="管理后台精准分页设计示例"
                  />
                </div>
              </Card>
            </DSRow>
            <DSRow label="admin-shell 基础 Token">
              <div className="grid w-full max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
                {[
                  ['#06070a', 'Canvas'],
                  ['#07080b', 'Sidebar'],
                  ['#090a0e', 'Base'],
                  ['#0e0f14', 'Card'],
                  ['#111219', 'Raised'],
                  ['#090a0f', 'Inset'],
                  ['#0b0c12', 'Floating'],
                ].map(([value, label]) => (
                  <div key={label} className="overflow-hidden rounded-xl border border-white/[0.1] bg-[#090a0e]">
                    <div className="h-14 border-b border-white/[0.08]" style={{ backgroundColor: value }} />
                    <div className="p-3">
                      <p className="text-xs font-semibold text-[#f6f3ee]">{label}</p>
                      <p className="mt-1 font-mono text-[10px] text-white/45">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="w-full max-w-5xl rounded-xl border border-white/[0.1] bg-[#0e0f14] p-4 text-xs leading-5 text-white/55">
                主文字固定 <code>#f6f3ee</code>；边框按白色 7.5% / 10% / 15% 分为分隔、默认与强调三级；键盘焦点使用 <code>#c4b5fd</code>。不要用提高模糊度代替表面层级。
              </div>
            </DSRow>
            <DSRow label="表面层级与毛玻璃边界">
              <div className="grid w-full max-w-5xl gap-4 lg:grid-cols-[1.15fr_.85fr]">
                <div className="rounded-2xl border border-white/[0.075] bg-[#06070a] p-4 sm:p-5">
                  <div className="rounded-xl border border-white/[0.075] bg-[#090a0e] p-4">
                    <p className="text-xs font-medium text-white/45">Base · 页面承载</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/[0.1] bg-[#0e0f14] p-4">
                        <p className="text-sm font-semibold text-[#f6f3ee]">Card · 数据分组</p>
                        <p className="mt-1 text-xs text-white/45">无 blur，无装饰渐变。</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.15] bg-[#111219] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.24)]">
                        <p className="text-sm font-semibold text-[#f6f3ee]">Raised · 重点面板</p>
                        <p className="mt-1 text-xs text-white/45">依靠亮度、边框和投影抬升。</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-white/[0.075] bg-[#090a0f] p-4">
                      <p className="text-xs font-medium text-white/50">Inset · 图表绘图区 / 表头 / 只读证据</p>
                    </div>
                  </div>
                </div>
                <div className="relative min-h-52 overflow-hidden rounded-2xl border border-white/[0.075] bg-[#06070a] p-5">
                  <div className="absolute inset-x-8 top-8 h-24 rounded-full bg-violet-500/[0.06] blur-3xl" aria-hidden="true" />
                  <div className="relative rounded-xl border border-white/[0.15] bg-[#0b0c12]/90 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                    <p className="text-sm font-semibold text-[#f6f3ee]">Floating · 菜单 / 弹窗</p>
                    <p className="mt-2 text-xs leading-5 text-white/50">只有确实覆盖页面内容的浮层允许 backdrop blur；下拉、日期面板和弹窗继续使用 Portal、视口避让与回焦。</p>
                  </div>
                </div>
              </div>
            </DSRow>
            <DSRow label="壳层、页面宽度与标题">
              <Card className="w-full max-w-5xl !border-white/[0.1] !bg-[#0e0f14] !backdrop-blur-none p-5">
                <div className="grid gap-5 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['248px 哑光侧栏', '桌面固定约 248px，使用 #07080b；选中态只有细高光线、局部底色和轻边框。'],
                    ['普通页 1440px', '公告、套餐、开关、支付、订单、用户、工单、发票、流水、任务与审计统一限宽。'],
                    ['Dashboard 1600px', '仪表盘允许更宽的趋势与概览，但图表绘图区不能随 2560px 视口无限拉伸。'],
                    ['成本看盘 1760px', '只为高密度成本证据使用；宽表在自身容器横向滚动，不放大整个页面。'],
                  ].map(([title, copy]) => (
                    <div key={title} className="border-l border-white/[0.1] pl-4">
                      <p className="font-semibold text-[#f6f3ee]">{title}</p>
                      <p className="mt-2 text-xs leading-5 text-white/50">{copy}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 border-t border-white/[0.08] pt-4 text-xs leading-5 text-white/55">
                  页面标题使用暖白实色、紧字距和可选 eyebrow，不默认使用紫蓝渐变；说明文字限制行宽。手机抽屉覆盖工作区并锁定焦点，页面根节点始终保持 <code>overflow-x: hidden</code>。
                </div>
              </Card>
            </DSRow>
            <DSRow label="指标卡与颜色配额">
              <div className="grid w-full max-w-5xl gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['¥12,480', '本月收入', 'text-violet-200 bg-violet-400/10 border-violet-300/15'],
                  ['98.6%', 'API 成功率', 'text-blue-200 bg-blue-400/10 border-blue-300/15'],
                  ['2', '待处理工单', 'text-amber-200 bg-amber-400/10 border-amber-300/15'],
                  ['0', '支付失败', 'text-red-200 bg-red-400/10 border-red-300/15'],
                ].map(([value, label, tone]) => (
                  <div key={label} className="rounded-2xl border border-white/[0.1] bg-[#111219] p-4 shadow-[0_14px_32px_rgba(0,0,0,0.22)]">
                    <span className={`inline-flex rounded-lg border px-2 py-1 text-[10px] ${tone}`}>{label}</span>
                    <p className="mt-5 text-2xl font-bold tracking-[-0.03em] text-[#f6f3ee]">{value}</p>
                    <p className="mt-1 text-xs text-white/45">口径说明放在数字下方</p>
                  </div>
                ))}
              </div>
              <p className="w-full max-w-5xl text-xs leading-5 text-white/50">
                指标卡主体保持石墨色，色彩只出现在小型语义标记、图标底板或状态边框；不为每张卡分配不同彩虹渐变，也不把“0”包装成成功或已接入能力。
              </p>
            </DSRow>
            <DSRow label="运营告警语义">
              <div className="grid w-full max-w-5xl gap-3 sm:grid-cols-2">
                {[
                  ['API 成功率偏低', '近 7 日供应商接口成功率低于运营阈值。', 'border-red-400/20 bg-red-400/[0.07] text-red-200', '严重'],
                  ['费用快照待同步', '余额或账单快照尚未同步或已过期。', 'border-amber-400/20 bg-amber-400/[0.07] text-amber-100', '关注'],
                  ['同步已完成', '最近一次只读同步成功并保留证据时间。', 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-100', '正常'],
                  ['运营说明', '中性提醒或无风险的信息提示。', 'border-blue-400/20 bg-blue-400/[0.07] text-blue-100', '信息'],
                ].map(([title, copy, tone, status]) => (
                  <div key={title} className={`rounded-xl border p-4 ${tone}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{title}</p>
                        <p className="mt-1 text-xs leading-5 opacity-65">{copy}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px]">{status}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="w-full max-w-5xl text-xs leading-5 text-white/50">告警必须同时包含标题、原因或下一步和文字状态，不能只用颜色、图标或闪烁表达；相同业务状态在列表、详情、弹窗和图表中保持同一语义。</p>
            </DSRow>
            <DSRow label="后台入口与命名">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <ShieldCheck className="mb-2 h-5 w-5 text-purple-300" />
                    <p className="font-semibold text-white">后台名称</p>
                    <p className="mt-1 text-xs text-gray-400">左侧品牌区统一显示“管理后台”，副标题为“运营管理后台”。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">入口位置</p>
                    <p className="mt-1 text-xs text-gray-400">管理员账号在账户中心右上角显示“进入管理后台”，用户端 sidebar 不混入后台菜单。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">设计规范位置</p>
                    <p className="mt-1 text-xs text-gray-400">设计规范放在管理后台侧边栏“操作审计”下方。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">返回用户端</p>
                    <p className="mt-1 text-xs text-gray-400">左下角返回入口固定进入 <code>/app</code>，登录状态由后端校验 HttpOnly 会话 Cookie。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="平台公告">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">导航位置</p>
                    <p className="mt-1 text-xs text-gray-400">固定放在“仪表盘”和“订阅套餐”之间。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">后台能力</p>
                    <p className="mt-1 text-xs text-gray-400">支持新增、修改、删除、查看详情、置顶和取消置顶。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">用户端展示</p>
                    <p className="mt-1 text-xs text-gray-400">仪表盘右下角展示最多 5 条公告，列表只显示标题和日期，不显示具体时间。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">排序规则</p>
                    <p className="mt-1 text-xs text-gray-400">置顶最多 3 条且优先展示；其余按发布时间倒序；点击公告打开详情。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="仪表盘指标卡">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">第一行</p>
                    <p className="mt-1 text-xs text-gray-400">今日收入 / 本月收入 / 总收入 / 支付失败数。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">第二行</p>
                    <p className="mt-1 text-xs text-gray-400">本月新增用户 / 非活跃用户 / 总注册用户。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">第三行</p>
                    <p className="mt-1 text-xs text-gray-400">API 成功率 / 待处理工单 / 待开发票。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">标题规则</p>
                    <p className="mt-1 text-xs text-gray-400">标题只放核心指标名；时间范围、确认收入、超 30 天等口径放辅助说明。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="功能开关规则">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">导航位置</p>
                    <p className="mt-1 text-xs text-gray-400">固定放在“积分消耗”和“订单管理”之间。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">影响范围</p>
                    <p className="mt-1 text-xs text-gray-400">只控制普通用户端工作区展示，管理员账号不受影响。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">用户端入口</p>
                    <p className="mt-1 text-xs text-gray-400">sidebar 入口始终保留，关闭后右侧显示升级提示。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">状态表达</p>
                    <p className="mt-1 text-xs text-gray-400">开启显示“已开启”，关闭显示紫色“升级中”。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="积分消耗规则">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <p className="font-semibold text-white">导航位置</p>
                    <p className="mt-1 text-xs text-gray-400">固定放在“订阅套餐”和“功能开关”之间，是 AI Studio 积分消耗的后台配置入口。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">视频组合</p>
                    <p className="mt-1 text-xs text-gray-400">Seedance 2.0 / Fast / Mini / 2.5 按输出时长与分辨率保留组合，并分别配置无参考视频和含参考视频积分；2.5 需通过模型级开关统一开放或暂停。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">后台操作</p>
                    <p className="mt-1 text-xs text-gray-400">当前开放的视频消耗通过“修改”按钮打开弹窗，二次确认后才生效，不在列表内直接编辑。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">用户端展示</p>
                    <p className="mt-1 text-xs text-gray-400">生成按钮必须展示本次预计积分；Fast / Mini 的 1080p 标为暂不开放且用户端不可选。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="客服与发票规则">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <Headphones className="mb-2 h-5 w-5 text-purple-300" />
                    <p className="font-semibold text-white">联系客服入口</p>
                    <p className="mt-1 text-xs text-gray-400">用户端 sidebar 底部固定放在“订阅套餐”和用户积分卡之间，只触发右侧工作区弹窗。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">提交问题</p>
                    <p className="mt-1 text-xs text-gray-400">进入工单管理，只展示问题类工单，不混入发票申请。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">申请发票</p>
                    <p className="mt-1 text-xs text-gray-400">进入发票管理，必须关联已支付订单，并展示抬头、税号、接收邮箱。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">订单同步</p>
                    <p className="mt-1 text-xs text-gray-400">订单列表显示未开票/已开票；发票管理人工标记后同步订单状态。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="订单管理规则">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <CreditCard className="mb-2 h-5 w-5 text-purple-300" />
                    <p className="font-semibold text-white">顶部数据卡</p>
                    <p className="mt-1 text-xs text-gray-400">订单管理顶部先展示三张金额卡，再展示对应的三张数量卡。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">时间维度</p>
                    <p className="mt-1 text-xs text-gray-400">右上角使用本日、近七日、本月、全部按钮筛选，默认全部。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">联动范围</p>
                    <p className="mt-1 text-xs text-gray-400">时间维度同时影响数据卡和订单列表；状态筛选作为二级筛选保留。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">日期口径</p>
                    <p className="mt-1 text-xs text-gray-400">优先按退款时间、支付时间、创建时间判断订单所属范围。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="计费闭环规则">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">订单到账</p>
                    <p className="mt-1 text-xs text-gray-400">支付成功后自动写入积分到账流水，主套餐和加购包分桶记录。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">退款冲销</p>
                    <p className="mt-1 text-xs text-gray-400">退款订单不计入确认收入；已到账积分仍可完整扣回时才生成金额一致的冲销流水。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">禁止退款</p>
                    <p className="mt-1 text-xs text-gray-400">到账积分已被消耗时禁止退款，提示「该订单到账积分已被消耗，无法退款」。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">积分展示</p>
                    <p className="mt-1 text-xs text-gray-400">用户端合并展示当前积分，后台详情必须区分主套餐积分和加购包积分。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">关联追溯</p>
                    <p className="mt-1 text-xs text-gray-400">订单、积分流水、生成任务和资产都要保留关联 ID。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="后台用户管理表格">
              <AdminTablePreviewCard />
              <Card className="w-full max-w-4xl !border-white/[0.1] !bg-[#0e0f14] !backdrop-blur-none p-5">
                <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['局部滚动', '宽表只在带边界的表格容器内 overflow-x-auto；页面、页头和筛选栏不随表格横滚。'],
                    ['稳定表头', '表头使用 Inset 表面和 7.5% 分隔线，表格主体保持 Card 表面，不叠第二层玻璃卡。'],
                    ['操作就近', '行级操作靠近对应记录并保持单行；高风险操作仍进入确认弹窗，不在单元格直接执行。'],
                    ['可读状态', '状态徽章同时显示文字；空值、未知、失败和已删除必须明确区分，不只依赖颜色。'],
                  ].map(([title, copy]) => (
                    <div key={title}>
                      <p className="font-semibold text-[#f6f3ee]">{title}</p>
                      <p className="mt-1 text-xs leading-5 text-white/50">{copy}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </DSRow>
            <DSRow label="用户管理字段规则">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <Users className="mb-2 h-5 w-5 text-blue-300" />
                    <p className="font-semibold text-white">列表列</p>
                    <p className="mt-1 text-xs text-gray-400">用户 / 套餐 / 积分 / 套餐重置时间 / 状态 / 最近活跃 / 操作。</p>
                  </div>
                  <div>
                    <RotateCcw className="mb-2 h-5 w-5 text-purple-300" />
                    <p className="font-semibold text-white">重置时间</p>
                    <p className="mt-1 text-xs text-gray-400">套餐重置时间固定放在积分后一列，与最近活跃日期列对齐。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">API 调用</p>
                    <p className="mt-1 text-xs text-gray-400">用户管理列表不显示 API 调用；成本看盘也不展示客户 API Key 主列表。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">垂直居中</p>
                    <p className="mt-1 text-xs text-gray-400">表头、明细、徽章、按钮统一使用单元格容器垂直居中。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="成本看盘规则">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">经营主看盘</p>
                    <p className="mt-1 text-xs text-gray-400">主页面只突出当前余额、最终实扣积分、官网按量成本和官方同价对账。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">任务统一口径</p>
                    <p className="mt-1 text-xs text-gray-400">周期按北京时间任务发起日归属；一个任务一行，重试成本累加但积分只结算一次。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">余额与成本</p>
                    <p className="mt-1 text-xs text-gray-400">全账户余额是当前资产，不随历史周期变化；人民币成本是六位小数官网按量价估算。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">高级对账</p>
                    <p className="mt-1 text-xs text-gray-400">Token、价格版本、历史补记、跨日归因和资源包证据只在独立高级页展示。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="后台表单与高风险操作">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <p className="font-semibold text-white">下拉筛选</p>
                    <p className="mt-1 text-xs text-gray-400">不使用原生裸 select；触发器使用石墨实色控件，Portal 菜单才使用 Floating 表面与克制 blur；紫色只表达当前选中和键盘焦点。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">二次确认</p>
                    <p className="mt-1 text-xs text-gray-400">冻结/解冻、调整积分、修改套餐、上下架、任务重试等高风险操作必须弹窗确认。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">订阅套餐数据源</p>
                    <p className="mt-1 text-xs text-gray-400">后台套餐接口返回全量；公开接口返回全部上架套餐。首页仅展示 <code>active</code>、主套餐且 <code>landingVisible=true</code> 的项目，固定显示月付价与前 5 条权益；订阅页仍展示全部上架主套餐、完整权益和加购包。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="生成任务监控">
              <Card className="w-full max-w-3xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-semibold text-white">积分状态</p>
                    <p className="mt-1 text-xs text-gray-400">分析中预扣、完成结算、失败自动退回；历史取消记录的退款状态仍需可见。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">失败分类</p>
                    <p className="mt-1 text-xs text-gray-400">余额不足、供应商失败、内容违规、系统超时。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">运营动作</p>
                    <p className="mt-1 text-xs text-gray-400">失败重试、退回积分、查看关联资产都需要按状态限制展示。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">审计记录</p>
                    <p className="mt-1 text-xs text-gray-400">任务重试、人工退回积分、退款冲销必须进入操作审计。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="动效与 reduced-motion">
              <Card className="w-full max-w-5xl !border-white/[0.1] !bg-[#0e0f14] !backdrop-blur-none p-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    ['120ms · 即时反馈', '按钮按下、焦点、徽章和轻量颜色变化。'],
                    ['180ms · 常规交互', '卡片 hover、筛选切换、表格行与菜单状态。'],
                    ['240ms · 空间关系', '抽屉、弹窗和需要表达进入/退出关系的浮层。'],
                  ].map(([title, copy]) => (
                    <div key={title} className="rounded-xl border border-white/[0.08] bg-[#090a0f] p-4">
                      <p className="text-sm font-semibold text-[#f6f3ee]">{title}</p>
                      <p className="mt-2 text-xs leading-5 text-white/50">{copy}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs leading-5 text-white/50">
                  统一缓动为 <code>cubic-bezier(0.22, 1, 0.36, 1)</code>；普通卡片最多上移 1–2px，不使用级联长入场、循环光球、图标脉冲或大范围背景呼吸。<code>prefers-reduced-motion</code> 下取消位移、缩放和循环，只保留即时颜色或可见性反馈。
                </p>
              </Card>
            </DSRow>
            <DSRow label="响应式与键盘验收">
              <div className="grid w-full max-w-5xl gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['390px', '顶部二级导航横向滚动；后台主侧栏使用焦点锁定抽屉；页面本身无横向溢出。'],
                  ['1440px', '248px 侧栏与 1440px 普通内容上限协调；筛选、页头和主要操作不挤压。'],
                  ['1920px', 'Dashboard 最大 1600px，成本看盘最大 1760px；图表绘图区保持合理行宽。'],
                  ['2560px', '内容居中且不无限拉伸；宽表仍只在自身容器滚动，静态环境光不扩散到全屏。'],
                ].map(([viewport, copy]) => (
                  <div key={viewport} className="rounded-xl border border-white/[0.1] bg-[#111219] p-4">
                    <p className="font-mono text-xs font-semibold text-violet-200">{viewport}</p>
                    <p className="mt-2 text-xs leading-5 text-white/50">{copy}</p>
                  </div>
                ))}
              </div>
              <p className="w-full max-w-5xl text-xs leading-5 text-white/50">
                抽屉、菜单和弹窗必须支持 Tab/Shift+Tab 焦点循环、Escape 关闭与关闭后回焦；所有操作保留可见 <code>focus-visible</code>。正文达到 WCAG AA，对比度和状态信息不能依赖 hover 或 Tooltip。
              </p>
            </DSRow>
          </DSSection>
        )}

        {/* Layout */}
        {activeSection === 'layout' && (
          <DSSection title="布局规范">
            <DSRow label="页面容器 (Page wrapper)">
              <code className="text-xs text-purple-300 bg-white/5 px-3 py-2 rounded-lg">
                {'<AppPage width="standard | wide | workspace" className="space-y-6">'}
              </code>
              <span className="text-xs text-gray-400">普通页 1280px，Dashboard 1600px，生产工作区全宽。</span>
            </DSRow>
            <DSRow label="双栏布局 (Two-column)">
              <code className="text-xs text-purple-300 bg-white/5 px-3 py-2 rounded-lg">
                {'<div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">'}
              </code>
            </DSRow>
            <DSRow label="侧边栏 + 内容 (Sidebar layout)">
              <code className="text-xs text-purple-300 bg-white/5 px-3 py-2 rounded-lg">
                {'<div className="flex h-full overflow-hidden">'}
              </code>
            </DSRow>
            <DSRow label="Sidebar 订阅积分卡">
              <SubscriptionCreditsPreviewCard />
              <span className="max-w-sm text-xs text-gray-400">
                必须展示用户名、套餐、当前积分 / 周期总额度、积分重置日期和到期日期；点击进入账户中心，订阅套餐入口保持独立。
              </span>
            </DSRow>
            <DSRow label="Sidebar 联系客服入口与工作区弹窗">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <p className="font-semibold text-white">入口位置</p>
                    <p className="mt-1 text-xs text-gray-400">固定在“订阅套餐”按钮和用户积分卡之间，不参与页面选中态。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">弹窗结构</p>
                    <p className="mt-1 text-xs text-gray-400">由右侧工作区承载并居中显示；右侧二维码区使用紧凑白底圆角卡片，展示“Lindyson AI 客服”和扫码提示。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">邮箱规则</p>
                    <p className="mt-1 text-xs text-gray-400">联系邮箱固定使用当前登录账号邮箱，不可编辑；发票接收邮箱可自行填写并做基础格式校验。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="稳定滚动条 (Scrollbar gutter)">
              <code className="text-xs text-purple-300 bg-white/5 px-3 py-2 rounded-lg">
                {'scrollbar-gutter-stable'}
              </code>
              <span className="text-xs text-gray-400">有条件出现滚动条的居中工作区必须保留稳定 gutter，避免 Tab 切换横向抖动。</span>
            </DSRow>
            <DSRow label="加载态 (Loading state)">
              <Card className="w-full max-w-2xl p-5">
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <p className="font-semibold text-white">统一组件</p>
                    <p className="mt-1 text-xs text-gray-400">全站路由和后台页面切换统一使用 LoadingState，不再使用静态“正在加载...”卡片。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">视觉规则</p>
                    <p className="mt-1 text-xs text-gray-400">用户端与管理后台都使用近黑实色和单一进度强调；后台通过独立 admin-shell 保持更中性、更高密度。循环动效统一受 reduced-motion 约束。</p>
                  </div>
                  <div>
                    <p className="font-semibold text-white">两种形态</p>
                    <p className="mt-1 text-xs text-gray-400">fullscreen 用于首次进入页面，panel 用于后台内部懒加载，不解释加载原因。</p>
                  </div>
                </div>
              </Card>
            </DSRow>
            <DSRow label="数字资产卡片网格 (Grid)">
              <div className="space-y-2">
                <code className="block text-xs text-purple-300 bg-white/5 px-3 py-2 rounded-lg">
                  {'digital-asset-card-grid @container + 2/3/5/6/10 列容器查询'}
                </code>
                <p className="text-xs text-gray-400">数字资产固定请求 30 条；按右侧容器宽度调整卡片尺寸，列数只选 30 的约数，不使用 auto-fill。AI Studio 与 TikTok 素材选择器仍为 24 条。</p>
              </div>
            </DSRow>
            <DSRow label="模态弹窗 (Modal)">
              <code className="text-xs text-purple-300 bg-white/5 px-3 py-2 rounded-lg">
                {'fixed inset-0 z-50 flex items-center justify-center p-4'}
              </code>
            </DSRow>
          </DSSection>
        )}

      </div>
    </div>
  );
}
