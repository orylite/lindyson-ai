import { describe, expect, it } from 'vitest';
import type { AdminGenerationJob } from '../data/admin';
import type { Asset } from '../data/assets';
import { buildDashboardData } from './dashboard';

describe('dashboard data', () => {
  it('聚合接口不可用时不使用当前任务列表伪造累计统计', () => {
    const data = buildDashboardData({
      generationJobs: [],
      assets: [],
      authorizedTikTokCount: 0,
      range: '7d',
    });

    expect(data.summary).toBeNull();
    expect(data.trendData).toEqual([]);
    expect(data.toolUsage).toEqual([]);
    expect(data.recentProjects).toEqual([]);
  });

  it('仅使用服务端完整聚合展示 KPI、趋势和工具占比', () => {
    const data = buildDashboardData({
      generationJobs: [
        job({ id: 'job-video-1', kind: 'video', model: 'Seedance 2.0', time: '2026-06-30 10:00' }),
        job({ id: 'job-image-1', kind: 'image', model: 'Seedream 5.0 Pro', time: '2026-07-01 09:00' }),
        job({ id: 'job-video-2', kind: 'video', model: 'Seedance 2.0', time: '2026-06-20 09:00' }),
      ],
      assets: [],
      authorizedTikTokCount: 0,
      range: '7d',
      aggregate: {
        summary: { totalGenerations: 3, videoGenerations: 2, imageGenerations: 1 },
        trend: [
          { day: '2026-06-30', videos: 1, images: 0 },
          { day: '2026-07-01', videos: 0, images: 1 },
        ],
        modelUsage: [
          { model: 'Seedance 2.0', count: 2 },
          { model: 'Seedream 5.0 Pro', count: 1 },
        ],
        timezone: 'Asia/Shanghai',
      },
    });

    expect(data.summary).toMatchObject({ totalGenerations: 3, videoGenerations: 2, imageGenerations: 1 });
    expect(data.trendData.find(item => item.day === '6月30日')).toMatchObject({ videos: 1, images: 0 });
    expect(data.trendData.find(item => item.day === '7月1日')).toMatchObject({ videos: 0, images: 1 });
    expect(data.toolUsage.map(item => [item.name, item.value])).toEqual([
      ['Seedance 2.0', 67],
      ['Seedream 5.0 Pro', 33],
    ]);
  });

  it('无图片生成记录时展示 Seedream 零值明细但不改写真实占比', () => {
    const data = buildDashboardData({
      generationJobs: [],
      assets: [],
      authorizedTikTokCount: 0,
      range: '7d',
      aggregate: {
        summary: { totalGenerations: 20, videoGenerations: 20, imageGenerations: 0 },
        trend: [],
        modelUsage: [
          { model: 'Seedance 2.0 Mini', count: 11 },
          { model: 'Seedance 2.0', count: 8 },
          { model: 'Seedance 2.0 Fast', count: 1 },
        ],
        timezone: 'Asia/Shanghai',
      },
    });

    expect(data.toolUsage.map(item => [item.name, item.count, item.value, item.color])).toEqual([
      ['Seedance 2.0 Mini', 11, 55, '#8b5cf6'],
      ['Seedance 2.0', 8, 40, '#3b82f6'],
      ['Seedance 2.0 Fast', 1, 5, '#ec4899'],
      ['Seedream 5.0 Pro', 0, 0, '#06b6d4'],
    ]);
  });

  it('近7日严格截取连续30日序列的最后7天并保留零值', () => {
    const data = buildDashboardData({
      generationJobs: [],
      assets: [],
      authorizedTikTokCount: 0,
      range: '7d',
      aggregate: dashboardAggregateWithThirtyDayTrend(),
    });

    expect(data.trendData).toHaveLength(7);
    expect(data.trendData[0]).toEqual({ day: '1月7日', videos: 2, images: 0 });
    expect(data.trendData[1]).toEqual({ day: '1月8日', videos: 0, images: 0 });
    expect(data.trendData[data.trendData.length - 1]).toEqual({ day: '1月13日', videos: 0, images: 1 });
  });

  it('近30日保留跨月跨年的完整连续日期序列', () => {
    const data = buildDashboardData({
      generationJobs: [],
      assets: [],
      authorizedTikTokCount: 0,
      range: '30d',
      aggregate: dashboardAggregateWithThirtyDayTrend(),
    });

    expect(data.trendData).toHaveLength(30);
    expect(data.trendData[0]).toEqual({ day: '12月15日', videos: 1, images: 0 });
    expect(data.trendData[data.trendData.length - 1]).toEqual({ day: '1月13日', videos: 0, images: 1 });
  });

  it('最近项目直接使用聚合接口缩略图并按完成时间显示北京时间日期', () => {
    const data = buildDashboardData({
      generationJobs: [],
      assets: [],
      authorizedTikTokCount: 0,
      range: '7d',
      aggregate: {
        summary: { totalGenerations: 1, videoGenerations: 0, imageGenerations: 1 },
        trend: [],
        modelUsage: [{ model: 'Seedream 5.0 Pro', count: 1 }],
        recentProjects: [{
          id: 'job-image-1',
          kind: 'image',
          model: 'Seedream 5.0 Pro',
          status: 'completed',
          assetId: 'asset-image-1',
          assetName: '夏日产品图',
          previewUrl: 'https://cdn.example.com/dashboard-image.webp',
          createdAt: '2026-07-01T16:59:00.000Z',
          completedAt: '2026-07-01T17:02:00.000Z',
        }],
        timezone: 'Asia/Shanghai',
      },
    });

    expect(data.recentProjects).toEqual([expect.objectContaining({
      assetId: 'asset-image-1',
      kind: 'image',
      model: 'Seedream 5.0 Pro',
      name: '夏日产品图',
      generatedAt: '2026-07-01T17:02:00.000Z',
      generatedDate: '2026-07-02',
      status: '完成',
    })]);
    expect(data.recentProjects[0]).not.toHaveProperty('time');
    expect(data.recentProjects[0]?.previewAsset?.thumbnailUrl).toBe('https://cdn.example.com/dashboard-image.webp');
  });

  it('聚合最近项目防御性忽略非完成任务和无资产任务', () => {
    const data = buildDashboardData({
      generationJobs: [],
      assets: [],
      authorizedTikTokCount: 0,
      range: '7d',
      aggregate: {
        summary: { totalGenerations: 1, videoGenerations: 1, imageGenerations: 0 },
        trend: [],
        modelUsage: [],
        recentProjects: [
          { id: 'failed', kind: 'video', model: 'Seedance 2.0', status: 'failed', assetId: null, assetName: null, previewUrl: null, createdAt: '2026-07-01T10:00:00.000Z', completedAt: null },
          { id: 'missing-asset', kind: 'video', model: 'Seedance 2.0', status: 'completed', assetId: null, assetName: null, previewUrl: null, createdAt: '2026-07-01T09:00:00.000Z', completedAt: '2026-07-01T09:02:00.000Z' },
        ],
        timezone: 'Asia/Shanghai',
      },
    });

    expect(data.recentProjects).toEqual([]);
  });

  it('本地回退仅保留带有效 AI 资产的完成任务', () => {
    const data = buildDashboardData({
      generationJobs: [
        job({
          id: 'job-video-1',
          kind: 'video',
          model: 'Seedance 2.0',
          time: '2026-07-01 10:00',
          status: 'completed',
          assetId: 'asset-generated',
          assetName: '产品发布视频',
        }),
        job({
          id: 'job-video-failed',
          kind: 'video',
          model: 'Seedance 2.0 Fast',
          time: '2026-07-01 09:00',
          status: 'failed',
        }),
        job({
          id: 'job-completed-missing-asset',
          kind: 'image',
          model: 'Seedream 5.0 Pro',
          time: '2026-07-01 08:00',
          status: 'completed',
          assetId: 'asset-missing',
        }),
      ],
      assets: [
        asset({ id: 'asset-uploaded', name: '手动上传素材', source: 'uploaded-video', createdAt: '2026-07-01 11:00', thumbnailUrl: 'https://cdn.example.com/uploaded.webp' }),
        asset({ id: 'asset-generated', name: '产品发布视频', source: 'ai-video', createdAt: '2026-07-01 10:05', thumbnailUrl: 'https://cdn.example.com/generated.webp' }),
      ],
      authorizedTikTokCount: 0,
      range: '7d',
    });

    expect(data.recentProjects).toHaveLength(1);
    expect(data.recentProjects[0]).toMatchObject({
      assetId: 'asset-generated',
      kind: 'video',
      name: '产品发布视频',
      type: 'AI视频生成',
      status: '完成',
      generatedDate: '2026-07-01',
    });
    expect(data.recentProjects[0]?.previewAsset?.thumbnailUrl).toBe('https://cdn.example.com/generated.webp');
    expect(data.recentProjects[0]).not.toHaveProperty('time');
    expect(data.recentProjects.every(item => !('duration' in item))).toBe(true);
  });

  it('本地回退按生成时间倒序且最多保留六个真实成果', () => {
    const generationJobs = Array.from({ length: 7 }, (_, index) => job({
      id: `job-image-${index + 1}`,
      kind: 'image',
      model: 'Seedream 5.0 Pro',
      time: `2026-07-0${index + 1} 10:00`,
      assetId: `asset-image-${index + 1}`,
      assetName: `成果图片 ${index + 1}`,
    }));
    const assets = Array.from({ length: 7 }, (_, index) => asset({
      id: `asset-image-${index + 1}`,
      name: `成果图片 ${index + 1}`,
      source: 'ai-image',
      createdAt: `2026-07-0${index + 1} 10:00`,
    }));

    const data = buildDashboardData({
      generationJobs,
      assets,
      authorizedTikTokCount: 0,
      range: '7d',
    });

    expect(data.recentProjects).toHaveLength(6);
    expect(data.recentProjects.map(item => item.name)).toEqual([
      '成果图片 7',
      '成果图片 6',
      '成果图片 5',
      '成果图片 4',
      '成果图片 3',
      '成果图片 2',
    ]);
    expect(data.recentProjects.every(item => !('time' in item))).toBe(true);
  });
});

function dashboardAggregateWithThirtyDayTrend() {
  const trend = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 11, 15 + index));
    return {
      day: date.toISOString().slice(0, 10),
      videos: index === 0 ? 1 : index === 23 ? 2 : 0,
      images: index === 29 ? 1 : 0,
    };
  });

  return {
    summary: { totalGenerations: 4, videoGenerations: 3, imageGenerations: 1 },
    trend,
    modelUsage: [],
    timezone: 'Asia/Shanghai',
  };
}

function job(patch: Partial<AdminGenerationJob> & Pick<AdminGenerationJob, 'id' | 'kind' | 'model' | 'time'>): AdminGenerationJob {
  return {
    id: patch.id,
    time: patch.time,
    userName: '测试用户',
    email: 'test@example.com',
    kind: patch.kind,
    model: patch.model,
    status: patch.status ?? 'completed',
    duration: patch.duration ?? '已完成',
    credits: 20,
    reservedCredits: 20,
    settledCredits: patch.settledCredits ?? (patch.status === 'failed' ? 0 : 20),
    refundedCredits: patch.refundedCredits ?? (patch.status === 'failed' ? 20 : 0),
    creditStatus: patch.creditStatus ?? (patch.status === 'failed' ? 'refunded' : 'settled'),
    mainCreditsUsed: 20,
    addonCreditsUsed: 0,
    prompt: patch.prompt ?? '测试提示词',
    config: patch.config ?? '9:16 · 720p · 5s',
    failCategory: patch.failCategory,
    failReason: patch.failReason,
    assetId: patch.assetId,
    assetName: patch.assetName,
    assetSource: patch.assetSource,
    ledgerIds: patch.ledgerIds,
    retryCount: patch.retryCount ?? 0,
    processingStage: patch.processingStage,
    cancelState: patch.cancelState,
  };
}

function asset(patch: Partial<Asset> & Pick<Asset, 'id' | 'name' | 'source' | 'createdAt'>): Asset {
  const type = patch.type ?? (patch.source.includes('video') ? 'video' : patch.source.includes('audio') ? 'audio' : 'image');
  return {
    id: patch.id,
    name: patch.name,
    type,
    source: patch.source,
    folderId: patch.folderId ?? null,
    size: patch.size ?? '12 MB',
    duration: patch.duration ?? (type === 'video' ? '10s' : undefined),
    dimensions: patch.dimensions ?? (type === 'image' ? '1024×1024' : undefined),
    createdAt: patch.createdAt,
    updatedAt: patch.updatedAt ?? patch.createdAt,
    thumbnail: patch.thumbnail ?? '',
    publicUrl: patch.publicUrl,
    thumbnailUrl: patch.thumbnailUrl,
    views: patch.views ?? 0,
    generation: patch.generation,
  };
}
