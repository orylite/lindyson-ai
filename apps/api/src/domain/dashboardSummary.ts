import type { DbClient } from '../db/pool.js';
import { signOwnedObjectReadUrls } from './assetReadUrlSigner.js';
import { toInt } from './serialization.js';

export async function getUserDashboardSummary(client: DbClient, userId: string) {
  const [summaryResult, trendResult, modelResult, recentResult] = await Promise.all([
    client.query(
      `SELECT count(*)::int AS total_generations,
              count(*) FILTER (WHERE task.kind = 'video')::int AS video_generations,
              count(*) FILTER (WHERE task.kind = 'image')::int AS image_generations
       FROM generation_tasks task
       WHERE task.user_id = $1
         AND task.status = 'completed'`,
      [userId],
    ),
    client.query(
      `WITH boundaries AS (
         SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date AS today
       ), trend_days AS (
         SELECT boundaries.today - offsets.day_offset AS day
         FROM boundaries
         CROSS JOIN generate_series(0, 29) AS offsets(day_offset)
       ), trend_counts AS (
         SELECT (task.completed_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
                (count(*) FILTER (WHERE task.kind = 'video'))::int AS videos,
                (count(*) FILTER (WHERE task.kind = 'image'))::int AS images
         FROM generation_tasks task
         CROSS JOIN boundaries
         WHERE task.user_id = $1
           AND task.status = 'completed'
           AND task.completed_at >= (
             (boundaries.today - 29)::timestamp AT TIME ZONE 'Asia/Shanghai'
           )
           AND task.completed_at < (
             (boundaries.today + 1)::timestamp AT TIME ZONE 'Asia/Shanghai'
           )
         GROUP BY day
       )
       SELECT to_char(trend_days.day, 'YYYY-MM-DD') AS day,
              coalesce(trend_counts.videos, 0)::int AS videos,
              coalesce(trend_counts.images, 0)::int AS images
       FROM trend_days
       LEFT JOIN trend_counts ON trend_counts.day = trend_days.day
       ORDER BY trend_days.day ASC`,
      [userId],
    ),
    client.query(
      `SELECT task.model, count(*)::int AS task_count
       FROM generation_tasks task
       WHERE task.user_id = $1
         AND task.status = 'completed'
       GROUP BY task.model
       ORDER BY task_count DESC, task.model ASC`,
      [userId],
    ),
    client.query(
      `SELECT task.id, task.kind, task.model, task.status, task.asset_id,
              asset.name AS asset_name,
              CASE
                WHEN asset.thumbnail_status = 'ready'
                 AND asset.thumbnail_key IS DISTINCT FROM asset.object_key
                THEN asset.thumbnail_key
                ELSE NULL
              END AS preview_key,
              task.created_at, task.completed_at
       FROM generation_tasks task
       JOIN assets asset
         ON asset.id = task.asset_id
        AND asset.user_id = task.user_id
        AND asset.deletion_status = 'active'
       WHERE task.user_id = $1
         AND task.status = 'completed'
         AND task.asset_id IS NOT NULL
         AND task.kind IN ('video', 'image')
       ORDER BY coalesce(task.completed_at, task.created_at) DESC, task.id DESC
       LIMIT 6`,
      [userId],
    ),
  ]);
  const row = summaryResult.rows[0] ?? {};
  const previewKeys = recentResult.rows.flatMap(item => item.preview_key ? [String(item.preview_key)] : []);
  const previewUrls = await signOwnedObjectReadUrls(previewKeys);

  return {
    summary: {
      totalGenerations: toInt(row.total_generations),
      videoGenerations: toInt(row.video_generations),
      imageGenerations: toInt(row.image_generations),
    },
    trend: trendResult.rows.map(item => ({
      day: String(item.day),
      videos: toInt(item.videos),
      images: toInt(item.images),
    })),
    modelUsage: modelResult.rows.map(item => ({
      model: String(item.model),
      count: toInt(item.task_count),
    })),
    recentProjects: recentResult.rows.map(item => ({
      id: String(item.id),
      kind: String(item.kind),
      model: String(item.model),
      status: String(item.status),
      assetId: item.asset_id ? String(item.asset_id) : null,
      assetName: item.asset_name ? String(item.asset_name) : null,
      previewUrl: item.preview_key ? previewUrls.get(String(item.preview_key)) ?? null : null,
      createdAt: new Date(item.created_at).toISOString(),
      completedAt: item.completed_at ? new Date(item.completed_at).toISOString() : null,
    })),
    timezone: 'Asia/Shanghai',
  };
}
