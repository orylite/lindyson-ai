import { ArrowRight, BarChart3, Eye, Image, Loader2, Megaphone, Pin, Play, RefreshCw, Sparkles, Users, Video, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AdminGenerationJob, PlatformAnnouncement } from '../data/admin';
import type { Asset } from '../data/assets';
import { buildDashboardData, type DashboardAggregate, type DashboardAggregateStatus, type DashboardRange, type DashboardRecentProject, type DashboardTrendPoint } from '../state/dashboard';
import { getAssetThumbnailUrl } from '../utils/assetPreview';
import type { BrowserDownloadResult } from '../utils/assetDownload';
import { AppPage, Badge, Button, Card, Dialog, EmptyState, PageHeader, SectionHeader, StatCard, TabBar } from '../ui';
import { AssetPreviewModal } from './AssetPreviewModal';

interface DashboardProps {
  announcements: PlatformAnnouncement[];
  generationJobs: AdminGenerationJob[];
  assets: Asset[];
  authorizedTikTokCount: number;
  aggregate: DashboardAggregate | null;
  aggregateStatus: DashboardAggregateStatus;
  onAssetDetailLoad: (assetId: string) => Promise<Asset>;
  onAssetDownload: (asset: Asset) => Promise<BrowserDownloadResult | null>;
  onStudioOpen: () => void;
  onAssetsOpen: () => void;
  onRetry: () => Promise<unknown>;
}

function getTrendYAxisConfig(data: DashboardTrendPoint[]) {
  const targetMax = Math.max(...data.flatMap(item => [item.videos, item.images]), 0) * 1.2;
  const step = targetMax <= 50 ? 10 : targetMax <= 200 ? 20 : 50;
  const max = Math.max(step, Math.ceil(targetMax / step) * step);
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) };
}

function RecentProjectCard({ item, loading, disabled, onOpen }: {
  item: DashboardRecentProject;
  loading: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const thumbnailUrl = item.previewAsset ? getAssetThumbnailUrl(item.previewAsset) : undefined;
  const MediaIcon = item.kind === 'video' ? Video : Image;
  const PreviewIcon = item.kind === 'video' ? Play : Eye;
  return (
    <button
      type="button"
      data-testid="dashboard-recent-project-card"
      data-kind={item.kind}
      onClick={onOpen}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      aria-haspopup="dialog"
      aria-label={`预览${item.kind === 'video' ? '视频' : '图片'}成果：${item.name}，生成于 ${item.generatedDate}`}
      className="product-media-card group w-[140px] flex-none overflow-hidden border text-left md:w-full"
    >
      <span data-testid="dashboard-recent-project-cover" className="relative flex aspect-[9/16] items-center justify-center overflow-hidden bg-[var(--product-surface-base)]">
        <MediaIcon aria-hidden="true" className="h-8 w-8 text-[var(--product-text-muted)]" />
        {thumbnailUrl && <img data-testid="dashboard-recent-project-thumbnail" src={thumbnailUrl} alt="" hidden={failed} onError={() => setFailed(true)} className="absolute inset-0 z-10 h-full w-full object-cover" />}
        <span data-testid="dashboard-recent-project-kind" className="product-media-surface absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-xs text-white">
          <MediaIcon aria-hidden="true" className="h-3 w-3" />{item.kind === 'video' ? '视频' : '图片'}
        </span>
        <span className={`${loading ? '' : 'product-preview-action'} absolute inset-0 z-20 flex items-center justify-center bg-black/15`}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-[var(--product-surface-base)] text-white">
            {loading ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : <PreviewIcon aria-hidden="true" className="h-5 w-5" />}
          </span>
        </span>
      </span>
    </button>
  );
}

function DashboardSkeleton({ projects = false }: { projects?: boolean }) {
  return <div role="status" aria-label="正在加载" className={projects ? 'flex gap-3 overflow-hidden py-1 md:grid md:grid-cols-6' : 'min-h-[320px] space-y-5 py-6'}>
    <span className="sr-only">正在加载</span>
    {Array.from({ length: projects ? 6 : 4 }, (_, index) => <div key={index} aria-hidden="true" className={`product-skeleton ${projects ? 'aspect-[9/16] w-[140px] flex-none md:w-full' : 'h-12'}`} />)}
  </div>;
}

export function Dashboard({ announcements, generationJobs, assets, authorizedTikTokCount, aggregate, aggregateStatus, onAssetDetailLoad, onAssetDownload, onStudioOpen, onAssetsOpen, onRetry }: DashboardProps) {
  const [activeRange, setActiveRange] = useState<DashboardRange>('7d');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<PlatformAnnouncement | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const latestAnnouncements = useMemo(() => [...announcements].sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.publishedAt.replace(' ', 'T')).getTime() - new Date(a.publishedAt.replace(' ', 'T')).getTime()).slice(0, 5), [announcements]);
  const dashboard = useMemo(() => buildDashboardData({ generationJobs, assets, authorizedTikTokCount, range: activeRange, aggregate }), [activeRange, aggregate, assets, authorizedTikTokCount, generationJobs]);
  const available = aggregateStatus === 'ready' && dashboard.summary !== null;
  const loading = aggregateStatus === 'idle' || aggregateStatus === 'loading';
  const trendEmpty = available && dashboard.trendData.every(point => point.videos === 0 && point.images === 0);
  const activeIndex = Math.max(0, selectedDay ? dashboard.trendData.findIndex(point => point.day === selectedDay) : dashboard.trendData.length - 1);
  const point = dashboard.trendData[activeIndex];
  const yAxis = getTrendYAxisConfig(dashboard.trendData);
  const summary = available ? dashboard.summary : null;
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError('');
    try { await onRetry(); } catch { setRetryError('仍无法加载，请稍后重试。'); } finally { setRetrying(false); }
  };
  const openRecentProject = async (item: DashboardRecentProject) => {
    if (loadingProjectId) return;
    setPreviewError('');
    setLoadingProjectId(item.id);
    try { setSelectedAsset(await onAssetDetailLoad(item.assetId)); }
    catch (error) { setPreviewError(error instanceof Error ? error.message : '素材预览加载失败，请再次点击作品重试'); }
    finally { setLoadingProjectId(null); }
  };
  // recharts 3 起 activeLabel 可能是数字；本图 X 轴 dataKey 是日期字符串，统一转成字符串比较。
  const selectChartDay = (state: { activeLabel?: string | number } | null) => {
    if (state?.activeLabel !== undefined && state.activeLabel !== null && state.activeLabel !== '') setSelectedDay(String(state.activeLabel));
  };

  return (
    <AppPage width="wide" className="space-y-6">
      <PageHeader title="仪表盘" titleTone="solid" subtitle="从一个想法，开始今天的创作" action={<Button onClick={onStudioOpen} icon={<Sparkles className="h-4 w-4" />}>开始创作</Button>} />
      {!available && !loading && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-200">
        <p>累计生成统计暂不可用。请重试以获取完整数据。{retryError}</p>
        <Button variant="secondary" loading={retrying} onClick={() => void retry()} icon={<RefreshCw className="h-4 w-4" />}>重新加载统计</Button>
      </div>}
      <section aria-labelledby="dashboard-summary-heading" aria-busy={loading}>
        <h2 id="dashboard-summary-heading" className="mb-3 text-sm font-semibold">数据概览</h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="累计生成次数" value={summary ? summary.totalGenerations.toLocaleString('zh-CN') : '—'} icon={<Sparkles className="h-5 w-5" />} gradient="" tone="product" accent="violet" />
          <StatCard label="累计视频生成" value={summary ? summary.videoGenerations.toLocaleString('zh-CN') : '—'} icon={<Video className="h-5 w-5" />} gradient="" tone="product" accent="blue" />
          <StatCard label="累计图片生成" value={summary ? summary.imageGenerations.toLocaleString('zh-CN') : '—'} icon={<Image className="h-5 w-5" />} gradient="" tone="product" accent="pink" />
          <StatCard label="已授权TikTok账号" value={authorizedTikTokCount.toLocaleString('zh-CN')} icon={<Users className="h-5 w-5" />} gradient="" tone="product" accent="slate" />
        </div>
      </section>

      <Card variant="raised" className="p-4 sm:p-6" data-testid="dashboard-recent-projects">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionHeader title="最近作品" />
          <Button variant="ghost" size="sm" onClick={onAssetsOpen} iconRight={<ArrowRight className="h-4 w-4" />}>查看全部</Button>
        </div>
        {previewError && <p role="alert" className="product-field-error mb-3">{previewError}，可再次点击作品重试。</p>}
        {loading ? <DashboardSkeleton projects /> : !available ? <EmptyState icon={<Image className="h-8 w-8" />} title="最近作品暂不可用" subtitle="请使用上方重新加载统计" className="min-h-48" /> : dashboard.recentProjects.length ? (
          <div data-testid="dashboard-recent-project-track" className="min-w-0">
            <ul aria-label="最近完成成果" className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pt-1 md:grid md:grid-cols-6 md:overflow-visible md:pb-0">
              {dashboard.recentProjects.slice(0, 6).map(item => <li key={item.id} className="flex-none snap-start md:min-w-0"><RecentProjectCard item={item} loading={loadingProjectId === item.id} disabled={loadingProjectId !== null} onOpen={() => void openRecentProject(item)} /></li>)}
            </ul>
          </div>
        ) : <div className="flex min-h-48 flex-col items-center justify-center py-5">
          <EmptyState icon={<Image className="h-8 w-8" />} title="暂无完成作品" subtitle="完成的 AI 图片与视频会显示在这里" className="py-4" />
          <Button variant="secondary" onClick={onStudioOpen}>开始创作</Button>
        </div>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <Card variant="raised" className="rounded-2xl p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div><SectionHeader title="创作趋势" /><p className="mt-1 text-xs text-[var(--product-text-muted)]">最近 {activeRange === '7d' ? '7' : '30'} 个自然日的视频与图片生成量</p></div>
            <TabBar tabs={[{ id: '7d', label: '近7日' }, { id: '30d', label: '近30日' }]} active={activeRange} onChange={range => { setActiveRange(range); setSelectedDay(null); }} tone="product" ariaLabel="创作趋势时间范围" />
          </div>
          {loading ? <DashboardSkeleton /> : !available ? <EmptyState icon={<BarChart3 className="h-8 w-8" />} title="创作趋势暂不可用" className="min-h-60" /> : trendEmpty ? <EmptyState icon={<BarChart3 className="h-8 w-8" />} title="这段时间暂无生成" subtitle="可切换时间范围，或开始新的创作" className="min-h-60" /> : <>
            <div className="mb-2 flex gap-4 text-xs text-[var(--product-text-secondary)]" aria-label="图表图例">
              <span><span aria-hidden="true" className="text-[var(--product-accent-violet)]">●</span> AI视频</span><span><span aria-hidden="true" className="text-[var(--product-accent-pink)]">●</span> AI图片</span>
            </div>
            <div
              className="h-[304px] w-full rounded-lg bg-[var(--product-surface-plot)]"
              role="img" tabIndex={0}
              aria-label={`${activeRange === '7d' ? '近7日' : '近30日'} AI视频与AI图片生成趋势`}
              aria-describedby="dashboard-trend-instructions dashboard-trend-value"
              onKeyDown={event => {
                let next = activeIndex;
                if (event.key === 'ArrowLeft') next = Math.max(0, activeIndex - 1);
                else if (event.key === 'ArrowRight') next = Math.min(dashboard.trendData.length - 1, activeIndex + 1);
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = dashboard.trendData.length - 1;
                else return;
                event.preventDefault();
                setSelectedDay(dashboard.trendData[next].day);
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dashboard.trendData} margin={{ top: 12, right: 32, left: -8, bottom: 4 }} onClick={selectChartDay} onMouseMove={selectChartDay}>
                  <defs><linearGradient id="dashboard-video-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--product-accent-violet)" stopOpacity={0.14} /><stop offset="100%" stopColor="var(--product-accent-violet)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="var(--product-border-default)" />
                  <XAxis dataKey="day" height={28} dy={5} interval="preserveStartEnd" minTickGap={activeRange === '30d' ? 24 : 12} padding={{ left: 8, right: 8 }} tick={{ fill: 'var(--product-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, yAxis.max]} ticks={yAxis.ticks} allowDecimals={false} width={36} tick={{ fill: 'var(--product-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--product-surface-floating)', border: '1px solid var(--product-border-strong)', borderRadius: 10, fontSize: 12 }} labelStyle={{ color: 'var(--product-text-primary)' }} itemStyle={{ color: 'var(--product-text-primary)' }} />
                  {point && <ReferenceLine x={point.day} stroke="var(--product-text-muted)" />}
                  <Area isAnimationActive={false} type="monotone" dataKey="videos" name="AI视频" stroke="var(--product-accent-violet)" strokeWidth={2} fill="url(#dashboard-video-fill)" />
                  <Area isAnimationActive={false} type="monotone" dataKey="images" name="AI图片" stroke="var(--product-accent-pink)" strokeWidth={2} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p id="dashboard-trend-instructions" className="sr-only">使用左右方向键查看相邻日期，Home 和 End 查看首尾日期。</p>
            <p id="dashboard-trend-value" role="status" className="sr-only">{point?.day}：视频 {point?.videos ?? 0} 次 · 图片 {point?.images ?? 0} 次</p>
          </>}
        </Card>
        <Card variant="raised" className="p-4 sm:p-6">
          <SectionHeader title="工具使用占比" /><p className="mt-1 text-xs text-[var(--product-text-muted)]">按生成模型汇总</p>
          {loading ? <DashboardSkeleton /> : !available ? <EmptyState icon={<BarChart3 className="h-8 w-8" />} title="工具统计暂不可用" className="min-h-60" /> : dashboard.toolUsage.some(item => item.count > 0) ? <ul className="mt-6 space-y-5" aria-label="工具使用占比明细">
            {dashboard.toolUsage.map((item, index) => <li key={item.name}>
              <div className="mb-2 flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words text-[var(--product-text-secondary)]">{item.name}</span><span className="tabular-nums">{item.value}%</span></div>
              <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-[var(--product-accent-violet)]" style={{ width: `${item.value}%`, backgroundColor: ['var(--product-accent-violet)', 'var(--product-accent-blue)', 'var(--product-accent-cyan)', 'var(--product-accent-pink)', 'var(--product-success)'][index % 5] }} /></div>
            </li>)}
          </ul> : <EmptyState icon={<BarChart3 className="h-8 w-8" />} title="暂无生成任务" className="min-h-60" />}
        </Card>
      </div>

      <Card variant="raised" accent="warm" className="p-4 sm:p-6">
        <SectionHeader title="平台公告" className="mb-2" />
        {latestAnnouncements.length ? <ul className="divide-y divide-white/5">{latestAnnouncements.map(announcement => <li key={announcement.id}>
          <button type="button" aria-label={`查看公告：${announcement.title}`} onClick={() => setSelectedAnnouncement(announcement)} className="flex w-full items-start gap-3 rounded-lg py-3 text-left transition-colors hover:bg-white/5">
            <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-[var(--product-text-muted)]" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{announcement.title}</span><span className="mt-1 block text-xs text-[var(--product-text-muted)]">{announcement.publishedAt.split(' ')[0]}</span></span>
            {announcement.pinned && <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--product-accent-violet)]"><Pin className="h-3 w-3" />置顶</span>}
          </button>
        </li>)}</ul> : <EmptyState icon={<Megaphone className="h-8 w-8" />} title="暂无公告" className="py-6" />}
      </Card>
      {selectedAnnouncement && (
        <Dialog
          onClose={() => setSelectedAnnouncement(null)}
          titleId="dashboard-announcement-title"
          panelClassName="max-w-lg"
        >
          <Card variant="modal" className="w-full max-w-lg p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedAnnouncement.pinned && <Badge variant="pink">置顶公告</Badge>}
                  <span className="text-xs text-[var(--product-text-muted)]">{selectedAnnouncement.publishedAt.split(' ')[0]}</span>
                </div>
                <h2 id="dashboard-announcement-title" className="mt-3 text-xl font-bold tracking-[-0.02em] text-[var(--product-text-primary)]">{selectedAnnouncement.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAnnouncement(null)}
                className="rounded-lg p-2 text-[var(--product-text-muted)] transition-colors duration-[var(--motion-standard)] hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-focus)]"
                aria-label="关闭公告详情"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-[var(--product-text-secondary)]">{selectedAnnouncement.content}</p>
          </Card>
        </Dialog>
      )}

      {selectedAsset && (
        <AssetPreviewModal
          key={`dashboard-project-preview-${selectedAsset.id}`}
          asset={selectedAsset}
          mode="readonly"
          rootFolderId={selectedAsset.folderId}
          onClose={() => setSelectedAsset(null)}
          onDownload={onAssetDownload}
          showReuseAction={false}
        />
      )}
    </AppPage>
  );
}
