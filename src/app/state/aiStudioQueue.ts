import type { AdminGenerationJob } from '../data/admin';
import type { Asset, AssetSource } from '../data/assets';

export type AIStudioQueueStatus = 'queued' | 'generating' | 'done' | 'failed' | 'canceled';
export type AIStudioQueueDisplayStatus = AIStudioQueueStatus | 'archiving';

export interface AIStudioQueueItem {
  id: string;
  kind: AdminGenerationJob['kind'];
  model: string;
  ratio: string;
  res: string;
  dur: string;
  time: string;
  status: AIStudioQueueStatus;
  displayStatus: AIStudioQueueDisplayStatus;
  assetId?: string;
  assetSource?: AssetSource;
  thumbnail?: string;
  previewReady?: boolean;
  assetUnavailable: boolean;
  creditSummary: string;
  reservedCredits: number;
  settledCredits: number;
  refundedCredits: number;
  creditStatus: AdminGenerationJob['creditStatus'];
  processingStage?: string | null;
  cancelState?: string;
  failReason?: string;
  stateMessage?: string;
  stateMessageTone?: 'info' | 'warning' | 'error';
}

export function buildAIStudioQueueItems(
  jobs: AdminGenerationJob[],
  assets: Asset[],
  kind: AdminGenerationJob['kind'] = 'video',
) {
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));

  return jobs
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => job.kind === kind)
    .map(({ job, index }) => ({
      item: toQueueItem(job, assetsById),
      createdAtMs: parseJobTime(job.createdAtIso ?? job.time),
      index,
    }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs || a.index - b.index)
    .map(({ item }) => item);
}

function toQueueItem(job: AdminGenerationJob, assetsById: Map<string, Asset>): AIStudioQueueItem {
  const config = job.configData ?? {};
  const asset = job.assetId ? assetsById.get(job.assetId) : undefined;
  const status = mapQueueStatus(job.status);
  const assetUnavailable = status === 'done' && Boolean(job.assetId) && job.assetAvailable === false;

  return {
    id: job.id,
    kind: job.kind,
    model: job.model,
    ratio: ratioConfig(config.aspectRatio ?? config.ratio),
    res: stringConfig(config.resolution ?? config.outputSize, '-'),
    dur: job.kind === 'image' ? '-' : durationConfig(config.durationSeconds ?? config.duration),
    time: formatQueueTime(job.createdAtIso ?? job.time),
    status,
    displayStatus: mapQueueDisplayStatus(status, job.processingStage),
    assetId: job.assetId,
    assetSource: toAssetSource(job.assetSource ?? asset?.source),
    thumbnail: assetUnavailable ? undefined : job.assetThumbnailUrl ?? asset?.thumbnail,
    previewReady: status === 'done' && Boolean(job.assetId) && !assetUnavailable,
    assetUnavailable,
    creditSummary: queueCreditSummary(job),
    reservedCredits: job.reservedCredits,
    settledCredits: job.settledCredits,
    refundedCredits: job.refundedCredits,
    creditStatus: job.creditStatus,
    processingStage: job.processingStage,
    cancelState: job.cancelState,
    failReason: queueFailReason(job),
    ...queueStateMessage(job, assetUnavailable),
  };
}

function mapQueueStatus(status: AdminGenerationJob['status']): AIStudioQueueStatus {
  if (status === 'processing') return 'generating';
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'canceled') return 'canceled';
  return 'queued';
}

function mapQueueDisplayStatus(
  status: AIStudioQueueStatus,
  processingStage?: string | null,
): AIStudioQueueDisplayStatus {
  if (status === 'done' || status === 'failed' || status === 'canceled') return status;
  if (processingStage === 'archiving' || processingStage === 'settlement-pending') return 'archiving';
  if (status === 'generating') return 'generating';
  return 'queued';
}

function queueFailReason(job: AdminGenerationJob) {
  if (job.status === 'failed' || job.status === 'canceled') return job.failReason;
  return undefined;
}

function queueCreditSummary(job: AdminGenerationJob) {
  if (job.creditStatus === 'held') return `冻结 ${job.reservedCredits} 积分`;
  if (job.creditStatus === 'refunded') return `已退 ${job.refundedCredits} / 预扣 ${job.reservedCredits} 积分`;
  if (job.creditStatus === 'settled') return `已扣 ${job.settledCredits} 积分`;
  if (job.creditStatus === 'reversed') return `已撤销 ${job.refundedCredits || job.reservedCredits} 积分`;
  return `积分 ${job.credits}`;
}

function queueStateMessage(
  job: AdminGenerationJob,
  assetUnavailable: boolean,
): Pick<AIStudioQueueItem, 'stateMessage' | 'stateMessageTone'> {
  if (assetUnavailable) {
    return {
      stateMessage: '素材已删除，无法预览或下载。',
      stateMessageTone: 'warning',
    };
  }
  if (job.cancelState === 'pending-provider' || job.processingStage === 'cancel-requested') {
    return {
      stateMessage: '取消请求已受理；供应商结果确认前积分继续冻结。',
      stateMessageTone: 'warning',
    };
  }
  if (job.processingStage === 'submission-unknown') {
    return {
      stateMessage: '供应商提交结果未知，系统不会重复提交或提前退款，正在等待核对。',
      stateMessageTone: 'warning',
    };
  }
  if (job.processingStage === 'settlement-pending') {
    return {
      stateMessage: '视频已生成，积分正在结算；最终实扣以账户流水为准。',
      stateMessageTone: 'info',
    };
  }
  if (job.status !== 'failed' && job.status !== 'canceled') return {};
  if (job.creditStatus === 'held') {
    return {
      stateMessage: '积分仍冻结，等待自动恢复或人工核对。',
      stateMessageTone: 'warning',
    };
  }
  if (job.creditStatus === 'settled') {
    return {
      stateMessage: `供应商已产生计费用量，已结算 ${job.settledCredits} 积分。`,
      stateMessageTone: 'warning',
    };
  }
  if (job.creditStatus === 'refunded') {
    const expiredCredits = Math.max(0, job.reservedCredits - job.refundedCredits);
    if (expiredCredits === 0) return {};
    return {
      stateMessage: `已退回 ${job.refundedCredits} 积分；${expiredCredits} 积分所属批次已过期，未恢复到账户。`,
      stateMessageTone: 'info',
    };
  }
  return {
    stateMessage: '积分结算状态以账户流水为准。',
    stateMessageTone: job.status === 'failed' ? 'error' : 'info',
  };
}

function stringConfig(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function ratioConfig(value: unknown) {
  const ratio = stringConfig(value, '-');
  return ratio === 'adaptive' ? '跟随首帧' : ratio;
}

function durationConfig(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '-';
  const trimmed = value.trim();
  if (!trimmed) return '-';
  return trimmed.endsWith('s') ? trimmed.slice(0, -1) : trimmed;
}

function toAssetSource(value: unknown): AssetSource | undefined {
  if (
    value === 'ai-video' ||
    value === 'ai-image' ||
    value === 'uploaded-video' ||
    value === 'uploaded-image' ||
    value === 'uploaded-audio'
  ) {
    return value;
  }
  return undefined;
}

function formatQueueTime(value: string | undefined) {
  const date = parseDate(value);
  if (!date) return value ?? '-';
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseJobTime(value: string | undefined) {
  return parseDate(value)?.getTime() ?? 0;
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number) {
  return value.toString().padStart(2, '0');
}
