import type { AdminGenerationJob } from '../data/admin';
import type { Asset } from '../data/assets';
import { formatBeijingDateTime } from '../utils/beijingTime';

export type DashboardRange = '7d' | '30d';
export type DashboardAggregateStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DashboardTrendPoint {
  day: string;
  videos: number;
  images: number;
}

export interface DashboardToolUsage {
  name: string;
  count: number;
  value: number;
  color: string;
}

export interface DashboardRecentProject {
  id: string;
  assetId: string;
  kind: 'video' | 'image';
  model: string;
  name: string;
  type: string;
  generatedAt: string;
  generatedDate: string;
  status: string;
  sortTime: number;
  previewAsset?: Pick<Asset, 'name' | 'type' | 'thumbnail' | 'thumbnailUrl' | 'publicUrl'>;
}

export interface DashboardSummary {
  totalGenerations: number;
  videoGenerations: number;
  imageGenerations: number;
  authorizedTikTokCount: number;
}

export interface DashboardData {
  summary: DashboardSummary | null;
  trendData: DashboardTrendPoint[];
  toolUsage: DashboardToolUsage[];
  recentProjects: DashboardRecentProject[];
}

export interface DashboardAggregate {
  summary: Pick<DashboardSummary, 'totalGenerations' | 'videoGenerations' | 'imageGenerations'>;
  trend: Array<{ day: string; videos: number; images: number }>;
  modelUsage: Array<{ model: string; count: number }>;
  recentProjects?: Array<{
    id: string;
    kind: 'video' | 'image';
    model: string;
    status: AdminGenerationJob['status'];
    assetId: string | null;
    assetName: string | null;
    previewUrl: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
  timezone: string;
}

const TOOL_COLORS = ['#8b5cf6', '#3b82f6', '#ec4899', '#f97316', '#10b981', '#f59e0b', '#06b6d4', '#ef4444'];
const TOOL_COLOR_BY_MODEL: Record<string, string> = {
  'Seedance 2.0 Mini': '#8b5cf6',
  'Seedance 2.0': '#3b82f6',
  'Seedance 2.0 Fast': '#ec4899',
  'Seedream 5.0 Pro': '#06b6d4',
};
const TOOL_USAGE_ZERO_ROWS = ['Seedream 5.0 Pro'] as const;
const MAX_RECENT_PROJECTS = 6;

export function buildDashboardData(input: {
  generationJobs: AdminGenerationJob[];
  assets: Asset[];
  authorizedTikTokCount: number;
  range: DashboardRange;
  aggregate?: DashboardAggregate | null;
}): DashboardData {
  return {
    summary: input.aggregate
      ? { ...input.aggregate.summary, authorizedTikTokCount: input.authorizedTikTokCount }
      : null,
    trendData: input.aggregate
      ? buildAggregateTrend(input.aggregate.trend, input.range)
      : [],
    toolUsage: input.aggregate
      ? buildAggregateToolUsage(input.aggregate.modelUsage)
      : [],
    recentProjects: input.aggregate?.recentProjects
      ? input.aggregate.recentProjects.flatMap(project => {
          const item = aggregateProjectToRecentProject(project);
          return item ? [item] : [];
        })
      : buildRecentProjects(input.generationJobs, input.assets),
  };
}

function aggregateProjectToRecentProject(
  project: NonNullable<DashboardAggregate['recentProjects']>[number],
): DashboardRecentProject | null {
  if (project.status !== 'completed' || !project.assetId) return null;

  const generatedAt = project.completedAt ?? project.createdAt;
  const timestamp = parseDateTime(generatedAt);
  const previewAsset = project.previewUrl
    ? {
        name: project.assetName || project.model,
        type: project.kind,
        thumbnail: project.previewUrl,
        thumbnailUrl: project.previewUrl,
        publicUrl: undefined,
      }
    : undefined;
  return {
    id: `job-${project.id}`,
    assetId: project.assetId,
    kind: project.kind,
    model: project.model,
    name: project.assetName || `${project.model} ${project.kind === 'video' ? '视频任务' : '图片任务'}`,
    type: project.kind === 'video' ? 'AI视频生成' : 'AI图片生成',
    generatedAt,
    generatedDate: formatGeneratedDate(generatedAt),
    status: '完成',
    sortTime: timestamp?.getTime() ?? 0,
    ...(previewAsset ? { previewAsset } : {}),
  };
}

function buildAggregateTrend(trend: DashboardAggregate['trend'], range: DashboardRange): DashboardTrendPoint[] {
  const items = trend.slice(range === '7d' ? -7 : -30);
  return items.map(item => ({
    day: formatAggregateDay(item.day),
    videos: item.videos,
    images: item.images,
  }));
}

function buildAggregateToolUsage(modelUsage: DashboardAggregate['modelUsage']): DashboardToolUsage[] {
  const total = modelUsage.reduce((sum, item) => sum + item.count, 0);
  if (total <= 0) return [];

  const rows = [...modelUsage];
  for (const model of TOOL_USAGE_ZERO_ROWS) {
    if (!rows.some(item => item.model === model)) rows.push({ model, count: 0 });
  }

  return rows
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
    .map((item, index) => ({
      name: item.model,
      count: item.count,
      value: Math.round((item.count / total) * 100),
      color: TOOL_COLOR_BY_MODEL[item.model] ?? TOOL_COLORS[index % TOOL_COLORS.length]!,
    }));
}

function formatAggregateDay(value: string) {
  const [, month, day] = value.split('-');
  return month && day ? `${Number(month)}月${Number(day)}日` : value;
}

export function buildRecentProjects(generationJobs: AdminGenerationJob[], assets: Asset[]): DashboardRecentProject[] {
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  return generationJobs
    .flatMap(job => {
      const asset = job.status === 'completed' && job.assetId ? assetsById.get(job.assetId) : undefined;
      if (!asset || (asset.source !== 'ai-video' && asset.source !== 'ai-image')) return [];

      const generatedAt = job.completedAt ?? job.createdAtIso ?? job.time;
      const timestamp = parseDateTime(generatedAt);
      return [{
        id: `job-${job.id}`,
        assetId: asset.id,
        kind: job.kind,
        model: job.model,
        name: job.assetName || asset.name,
        type: job.kind === 'video' ? 'AI视频生成' : 'AI图片生成',
        generatedAt,
        generatedDate: formatGeneratedDate(generatedAt),
        status: '完成',
        sortTime: timestamp?.getTime() ?? 0,
        previewAsset: asset,
      } satisfies DashboardRecentProject];
    })
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, MAX_RECENT_PROJECTS);
}

function formatGeneratedDate(value: string) {
  return formatBeijingDateTime(value).slice(0, 10);
}

export function parseDateTime(value: string) {
  if (!value || value === '-') return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
