import { describe, expect, it, vi } from 'vitest';
import { endpointContracts } from '@lindyson/api-contracts';
import { signOwnedObjectReadUrls } from '../src/domain/assetReadUrlSigner.js';
import { getUserDashboardSummary } from '../src/domain/dashboardSummary.js';

vi.mock('../src/domain/assetReadUrlSigner.js', () => ({
  signOwnedObjectReadUrls: vi.fn(async (keys: string[]) => new Map(
    keys.map(key => [key, `https://cdn.example.com/${encodeURIComponent(key)}`]),
  )),
}));

describe('用户仪表盘聚合', () => {
  it('仅聚合成功任务，并按完成日生成趋势', async () => {
    const trendRows = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 11, 15 + index));
      return {
        day: date.toISOString().slice(0, 10),
        videos: index === 0 ? '3' : 0,
        images: index === 29 ? 1 : 0,
      };
    });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ total_generations: '3', video_generations: 2, image_generations: 1 }] })
      .mockResolvedValueOnce({ rows: trendRows })
      .mockResolvedValueOnce({ rows: [
        { model: 'Seedance 2.0', task_count: '2' },
        { model: 'Seedream 5.0 Pro', task_count: '1' },
      ] })
      .mockResolvedValueOnce({ rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'video',
        model: 'Seedance 2.0',
        status: 'completed',
        asset_id: '22222222-2222-4222-8222-222222222222',
        asset_name: '最近成片',
        preview_key: 'users/user-1/thumbnails/recent.webp',
        created_at: '2026-07-11T10:00:00.000Z',
        completed_at: '2026-07-11T10:01:00.000Z',
      }, {
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'image',
        model: 'Seedream 5.0 Pro',
        status: 'completed',
        asset_id: '44444444-4444-4444-8444-444444444444',
        asset_name: '无缩略图成片',
        preview_key: null,
        created_at: '2026-07-11T09:00:00.000Z',
        completed_at: null,
      }] });

    const result = await getUserDashboardSummary({ query } as never, 'user-1');

    expect(result.summary).toEqual({ totalGenerations: 3, videoGenerations: 2, imageGenerations: 1 });
    expect(result.trend).toHaveLength(30);
    expect(result.trend[0]).toEqual({ day: '2025-12-15', videos: 3, images: 0 });
    expect(result.trend[1]).toEqual({ day: '2025-12-16', videos: 0, images: 0 });
    expect(result.trend[result.trend.length - 1]).toEqual({ day: '2026-01-13', videos: 0, images: 1 });
    expect(result.modelUsage).toEqual([
      { model: 'Seedance 2.0', count: 2 },
      { model: 'Seedream 5.0 Pro', count: 1 },
    ]);
    expect(result.recentProjects).toEqual([expect.objectContaining({
      id: '11111111-1111-4111-8111-111111111111',
      assetName: '最近成片',
      previewUrl: 'https://cdn.example.com/users%2Fuser-1%2Fthumbnails%2Frecent.webp',
      completedAt: '2026-07-11T10:01:00.000Z',
    }), expect.objectContaining({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'completed',
      previewUrl: null,
    })]);
    expect(query).toHaveBeenCalledTimes(4);
    const summarySql = String(query.mock.calls[0]?.[0]);
    expect(summarySql).toContain("task.status = 'completed'");
    expect(summarySql).not.toContain('LIMIT 40');
    const trendSql = String(query.mock.calls[1]?.[0]);
    expect(trendSql).toContain("now() AT TIME ZONE 'Asia/Shanghai'");
    expect(trendSql).toContain('generate_series(0, 29)');
    expect(trendSql).toContain('(boundaries.today - 29)::timestamp');
    expect(trendSql).toContain('(boundaries.today + 1)::timestamp');
    expect(trendSql).toContain("task.status = 'completed'");
    expect(trendSql).toContain("task.completed_at AT TIME ZONE 'Asia/Shanghai'");
    expect(trendSql).toContain('task.completed_at >=');
    expect(trendSql).toContain('task.completed_at <');
    expect(trendSql).not.toContain('task.created_at');
    expect(trendSql).toContain('coalesce(trend_counts.videos, 0)');
    expect(String(query.mock.calls[2]?.[0])).toContain("task.status = 'completed'");
    const recentSql = String(query.mock.calls[3]?.[0]);
    expect(recentSql).toContain("task.status = 'completed'");
    expect(recentSql).toContain("asset.deletion_status = 'active'");
    expect(recentSql).toContain("task.kind IN ('video', 'image')");
    expect(recentSql).toContain('ORDER BY coalesce(task.completed_at, task.created_at) DESC');
    expect(recentSql).toContain('LIMIT 6');
    expect(signOwnedObjectReadUrls).toHaveBeenCalledWith(['users/user-1/thumbnails/recent.webp']);
    expect(result.recentProjects).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ objectKey: expect.anything() }),
      expect.objectContaining({ publicUrl: expect.anything() }),
    ]));
    expect(() => endpointContracts.accountDashboard.response.parse(result)).not.toThrow();
  });
});
