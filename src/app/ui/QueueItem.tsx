import { CheckCircle2,Clock,Download,Loader2,Share2 } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode } from 'react';
import type { BadgeVariant } from './Badge';
import { Badge } from './Badge';

// Re-export the type so consumers don't need to import from Badge directly
export type { BadgeVariant };

type QueueStatus = 'queued' | 'generating' | 'publishing' | 'done' | 'failed';

interface QueueItemProps {
  id: string;
  /** URL or null for placeholder */
  thumbnail: string | null;
  /** aspect ratio class, e.g. 'aspect-[9/16]' or 'aspect-square' */
  thumbnailAspect?: string;
  thumbnailIcon?: ReactNode;
  title: string;
  meta?: string;
  time: string;
  status: QueueStatus;
  /** Extra badge label, e.g. "带货" */
  typeBadge?: string;
  typeBadgeColor?: string;
  onDownload?: () => void;
  onShare?: () => void;
}

const STATUS_MAP: Record<QueueStatus, { label: string; variant: BadgeVariant; icon?: ReactNode }> = {
  queued:      { label: '分析中',  variant: 'purple' },
  generating:  { label: '生成中',  variant: 'warning', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  publishing:  { label: '发布中',  variant: 'warning', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  done:        { label: '已完成',  variant: 'success', icon: <CheckCircle2 className="w-3 h-3" /> },
  failed:      { label: '失败',    variant: 'error' },
};

export function QueueItem({
  thumbnail,
  thumbnailAspect = 'aspect-[9/16]',
  thumbnailIcon,
  title,
  meta,
  time,
  status,
  typeBadge,
  typeBadgeColor = 'bg-purple-600/80',
  onDownload,
  onShare,
}: QueueItemProps) {
  const s = STATUS_MAP[status];
  const isDone = status === 'done';
  const isProcessing = status === 'generating' || status === 'publishing';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24,ease: [0.22,1,0.36,1] }}
      className="group flex items-center gap-3 rounded-xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-inset)] p-3"
    >
      {/* Thumbnail */}
      <div className={`w-14 ${thumbnailAspect} rounded-lg bg-gradient-to-br from-purple-900/60 to-blue-900/60 flex items-center justify-center flex-shrink-0 relative overflow-hidden`}>
        {thumbnail
          ? <img src={thumbnail} alt={title} className="w-full h-full object-cover" />
          : isProcessing
            ? <div className="w-5 h-5 border-2 border-purple-400/40 border-t-purple-400 rounded-full animate-spin" />
            : thumbnailIcon
        }
        {typeBadge && (
          <span className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${typeBadgeColor}`}>
            {typeBadge}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium text-white truncate">{title}</p>
        {meta && <p className="text-xs text-gray-400 truncate">{meta}</p>}
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Clock className="w-3 h-3 flex-shrink-0" />{time}
        </div>
        <Badge variant={s.variant} dot={!s.icon}>
          {s.icon}{s.label}
        </Badge>
      </div>

      {/* Actions */}
      {isDone && (onDownload || onShare) && (
        <div className="flex flex-col gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          {onDownload && (
            <button type="button" aria-label={`下载${title}`} onClick={onDownload} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 transition-colors hover:bg-purple-500/30">
              <Download className="w-3.5 h-3.5 text-gray-300" />
            </button>
          )}
          {onShare && (
            <button type="button" aria-label={`分享${title}`} onClick={onShare} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 transition-colors hover:bg-white/20">
              <Share2 className="w-3.5 h-3.5 text-gray-300" />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
