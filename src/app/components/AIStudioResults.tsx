import { Clock,Download,Image as ImageIcon,LoaderCircle,Play,Video,X } from 'lucide-react';
import { useState,type MouseEvent } from 'react';
import type { ExactCursorPagination,PagePosition } from '../api/cursor';
import type { AIStudioQueueItem } from '../state/aiStudioQueue';
import { AssetThumbnail,Card,Dialog } from '../ui';
import { CursorPagination } from './CursorPagination';

type StudioKind = 'video' | 'image';

interface AIStudioResultsProps {
  kind: StudioKind;
  items: AIStudioQueueItem[];
  pagination?: ExactCursorPagination;
  loading?: boolean;
  onNavigate: (position: PagePosition) => void;
  onPreview: (item: AIStudioQueueItem) => Promise<void>;
  onDownload: (event: MouseEvent<HTMLButtonElement>, item: AIStudioQueueItem) => Promise<void>;
  onEditFailed?: (event: MouseEvent<HTMLButtonElement>, item: AIStudioQueueItem) => Promise<void>;
  editingFailedJobId?: string | null;
}

export function AIStudioResults({ kind, items, pagination, loading, onNavigate, onPreview, onDownload, onEditFailed, editingFailedJobId }: AIStudioResultsProps) {
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsItem = items.find(item => item.id === detailsId);
  const Icon = kind === 'video' ? Video : ImageIcon;
  const accent = kind === 'video' ? 'text-violet-300' : 'text-pink-300';
  return (
    <section id={`ai-studio-${kind}-results`} tabIndex={-1} aria-labelledby={`ai-studio-${kind}-results-title`} data-testid={`ai-studio-${kind}-results`} className="min-w-0 scroll-mt-4 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">
      <Card variant="raised" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`ai-studio-${kind}-results-title`} className="flex items-center gap-2 text-sm font-semibold text-white"><Icon className={`h-4 w-4 ${accent}`} />生成记录</h3>
          <span className="text-xs text-gray-500">共 {pagination?.totalItems ?? items.length} 个任务</span>
        </div>
        <div className="@container/studio-results min-w-0" aria-busy={loading || undefined}>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-sm text-gray-500">
              <Icon className={`h-8 w-8 opacity-50 ${accent}`} />
              <p>{loading ? '正在加载生成记录...' : '暂无生成任务'}</p>
              {!loading && <p className="text-xs">生成的{kind === 'video' ? '视频' : '图片'}会显示在这里</p>}
            </div>
          ) : (
            <div data-testid="ai-studio-results-grid" className="grid grid-cols-1 gap-4 @min-[320px]/studio-results:grid-cols-2 @min-[540px]/studio-results:grid-cols-3 @min-[720px]/studio-results:grid-cols-4 @min-[1080px]/studio-results:grid-cols-6">
              {items.map(item => (
                <ResultCard key={item.id} onShowDetails={() => setDetailsId(item.id)} item={item} accent={accent} onPreview={onPreview} onDownload={onDownload} onEditFailed={onEditFailed} editingFailedJobId={editingFailedJobId} />
              ))}
            </div>
          )}
        </div>
        {pagination && <CursorPagination pagination={pagination} loading={loading} empty={items.length === 0} onNavigate={onNavigate} label={`${kind === 'video' ? '视频' : '图片'}生成队列翻页`} />}
      </Card>
      {detailsItem && (
        <Dialog onClose={() => setDetailsId(null)} titleId={`result-details-${detailsItem.id}`} panelClassName="max-w-lg rounded-2xl border border-white/10 bg-[#111119] p-5 text-white">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 id={`result-details-${detailsItem.id}`} className="text-base font-semibold">任务说明</h3>
            <button type="button" aria-label="关闭任务说明" onClick={() => setDetailsId(null)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"><X className="h-5 w-5" /></button>
          </div>
          <p className="mb-3 text-sm text-gray-400">{detailsItem.model} · {detailsItem.time}</p>
          <div className="max-h-[60dvh] space-y-3 overflow-y-auto whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {detailsItem.failReason && <p className="text-red-300">{detailsItem.failReason}</p>}
            {!detailsItem.assetUnavailable && detailsItem.stateMessage && <p className="text-gray-200">{detailsItem.stateMessage}</p>}
          </div>
        </Dialog>
      )}
    </section>
  );
}

function ResultCard({ item, accent, onPreview, onDownload, onEditFailed, editingFailedJobId, onShowDetails }: Pick<AIStudioResultsProps, 'onPreview' | 'onDownload' | 'onEditFailed' | 'editingFailedJobId'> & { item: AIStudioQueueItem; accent: string; onShowDetails: () => void }) {
  const meta = queueStatusMeta(item);
  const active = item.status === 'queued' || item.status === 'generating';
  const hasMessages = Boolean(item.failReason || (!item.assetUnavailable && item.stateMessage));
  return (
    <div data-testid="ai-studio-result-card" data-job-id={item.id} className={`product-media-card group relative aspect-[9/16] min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/5 ${item.previewReady ? 'cursor-pointer' : ''}`} onClick={() => item.previewReady && void onPreview(item)}>
      <div data-testid="ai-studio-result-preview" className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black/30">
        {item.assetUnavailable ? (
          <X className="absolute top-1/3 h-6 w-6 -translate-y-1/2 text-gray-500" />
        ) : item.status === 'failed' || item.status === 'canceled' ? null : active ? (
          <LoaderCircle className={`absolute top-1/3 h-6 w-6 -translate-y-1/2 animate-spin motion-reduce:animate-none ${accent}`} />
        ) : (
          <>
            <AssetThumbnail asset={{ name: item.model, type: item.kind, thumbnail: item.thumbnail ?? '' }} decorative imageClassName="block object-cover object-center" />
            {item.kind === 'video' && item.previewReady && <Play className="pointer-events-none absolute h-9 w-9 rounded-full bg-black/50 p-2 text-white" />}
          </>
        )}
        <span role="status" className={`absolute left-2 top-2 z-10 rounded-md px-2 py-1 text-xs ${meta.color}`}>{meta.label}</span>
      </div>
      <div data-testid="ai-studio-result-info" className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black via-black/90 to-transparent p-2.5 pt-8">
        <p className="truncate text-xs font-semibold text-white" title={item.model}>{item.model}</p>
        <p className="truncate text-xs text-gray-300" title={`${item.ratio} · ${item.res}${item.kind === 'video' ? ` · ${item.dur}s` : ''}`}>{item.ratio} · {item.res}{item.kind === 'video' && ` · ${item.dur}s`}</p>
        <p className="flex items-center gap-1 text-xs text-gray-300"><Clock className="h-3 w-3 shrink-0" />{item.time}</p>
        <p className={`truncate text-xs ${accent}`} title={item.creditSummary}>{item.creditSummary}</p>
        {hasMessages && (
          <div className="text-xs" onClick={event => event.stopPropagation()}>
            <p id={`result-message-${item.id}`} className="line-clamp-2 [overflow-wrap:anywhere]">
              {item.failReason && <span className="block whitespace-pre-line text-red-300">{item.failReason}</span>}
              {!item.assetUnavailable && item.stateMessage && (
                <span className={`block whitespace-pre-line ${item.stateMessageTone === 'error' ? 'text-red-300' : item.stateMessageTone === 'warning' ? 'text-amber-300' : 'text-blue-300'}`}>{item.stateMessage}</span>
              )}
            </p>
            <button type="button" aria-haspopup="dialog" onClick={onShowDetails} className={DETAIL_ACTION_CLASS}>查看说明</button>
          </div>
        )}
        {item.previewReady && (
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button type="button" className={ACTION_CLASS} title="预览" aria-label={item.kind === 'image' ? '预览图片' : '预览'} onClick={event => { event.stopPropagation(); void onPreview(item); }}><Play className="h-3.5 w-3.5" />预览</button>
            <button type="button" className={ACTION_CLASS} title="下载" aria-label={item.kind === 'image' ? '下载图片' : '下载'} onClick={event => { event.stopPropagation(); void onDownload(event, item); }}><Download className="h-3.5 w-3.5" />下载</button>
          </div>
        )}
        {item.status === 'failed' && onEditFailed && (
          <button type="button" disabled={editingFailedJobId != null} onClick={event => { event.stopPropagation(); void onEditFailed(event, item); }} className={DETAIL_ACTION_CLASS} title="载入原参数，修改后创建新任务">{editingFailedJobId === item.id ? '加载中...' : '修改参数并重试'}</button>
        )}
      </div>
    </div>
  );
}

const DETAIL_ACTION_CLASS = 'mt-1 flex min-h-9 w-full items-center justify-center rounded-lg border border-red-400/25 bg-red-500/10 px-2.5 py-2 text-xs font-medium leading-4 text-red-200 hover:bg-red-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-300 disabled:opacity-50';

const ACTION_CLASS = 'product-queue-action flex min-h-9 items-center justify-center gap-1 rounded-lg bg-white/15 px-1 py-2 text-xs text-gray-100 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400';

function queueStatusMeta(item: AIStudioQueueItem) {
  if (item.assetUnavailable) return { color: 'bg-gray-900/90 text-gray-300', label: '素材已删除' };
  if (item.cancelState === 'pending-provider' || item.processingStage === 'cancel-requested') return { color: 'bg-orange-950/90 text-orange-300', label: '取消确认中' };
  if (item.processingStage === 'submission-unknown') return { color: 'bg-orange-950/90 text-orange-300', label: '待核对' };
  if (item.processingStage === 'settlement-pending' && item.status !== 'done') return { color: 'bg-blue-950/90 text-blue-300', label: '结算中' };
  if (item.displayStatus === 'archiving') return { color: 'bg-blue-950/90 text-blue-300', label: '归档中' };
  if (item.status === 'done') return { color: 'bg-green-950/90 text-green-300', label: '已完成' };
  if (item.status === 'failed') return { color: 'bg-red-950/90 text-red-300', label: '失败' };
  if (item.status === 'canceled') return { color: 'bg-blue-950/90 text-blue-300', label: '已取消' };
  if (item.status === 'generating') return { color: 'bg-yellow-950/90 text-yellow-300', label: '生成中' };
  return { color: 'bg-violet-950/90 text-violet-300', label: '排队中' };
}
