import type { FastifyInstance } from 'fastify';
import {
  endpointContracts,
  type AssetFolderContentAction,
  type AssetFolderDeleteResultDto,
} from '@lindyson/api-contracts';
import { requireAuth } from '../auth/session.js';
import { pool, withReadOnlyRepeatableRead, withTransaction, type DbClient } from '../db/pool.js';
import { scheduleAssetDeletion } from '../domain/assetDeletionService.js';
import { prepareOwnedAssetDownload } from '../domain/assetDownloadService.js';
import { resolveAssetFolderId } from '../domain/assetFolders.js';
import {
  createAssetCardPage,
  materializeAssetCardPageQuery,
  parseAssetCardPageQuery,
} from '../domain/assetCardPagination.js';
import {
  exactPageMetadataColumns,
  readUserPaginationVersion,
  selectExactCursorPageRows,
  type ExactPageMetadata,
} from '../domain/cursorPagination.js';
import {
  mapAssetCardRow,
  mapAssetCardRows,
  mapAssetDetailRow,
  type AssetCardRow,
  type AssetRow,
} from '../domain/assets.js';
import { toIsoDateTime } from '../domain/serialization.js';
import {
  cancelOwnedUploadSession,
  createOrReplayUploadSession,
  getOwnedUploadSession,
  queueUploadCompletion,
  retryOwnedUploadSession,
} from '../domain/uploadSessionService.js';

interface AssetFolderRow {
  id: string;
  name: string;
  source: string;
  is_system: boolean;
  created_at: Date | string;
}

interface AssetSummaryRow {
  total: number | string;
  video_count: number | string;
  image_count: number | string;
  audio_count: number | string;
  ai_video_count: number | string;
  ai_image_count: number | string;
  uploaded_video_count: number | string;
  uploaded_image_count: number | string;
  uploaded_audio_count: number | string;
  downloaded_count: number | string;
}

interface AssetFolderCountRow {
  folder_id: string | null;
  count: number | string;
}

interface AssetFolderDeletionRecordRow {
  content_action: AssetFolderContentAction;
  affected_asset_count: number | string | null;
}

export async function registerAssetsRoutes(app: FastifyInstance) {
  app.get('/api/assets/cards', async request => {
    const user = await requireAuth(request);
    const rawQuery = endpointContracts.assetCards.query.parse(request.query);
    const pageRequest = parseAssetCardPageQuery(rawQuery, user.id);
    return withReadOnlyRepeatableRead(async client => {
      const conditions = [
        'user_id = $1',
        "deletion_status = 'active'",
      ];
      const baseValues: unknown[] = [user.id];
      const addCondition = (sql: (index: number) => string, value: unknown) => {
        baseValues.push(value);
        conditions.push(sql(baseValues.length));
      };
      if (pageRequest.source) addCondition(index => `source = $${index}`, pageRequest.source);
      if (pageRequest.type) addCondition(index => `type = $${index}`, pageRequest.type);
      if (pageRequest.folderId) addCondition(index => `folder_id = $${index}::uuid`, pageRequest.folderId);
      if (pageRequest.search) addCondition(index => `name ILIKE '%' || $${index} || '%'`, pageRequest.search);

      const version = await readUserPaginationVersion(client, user.id, 'assets');
      const totalItems = pageRequest.snapshot
        ? undefined
        : (await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM assets
             WHERE ${conditions.join('\n               AND ')}`,
            baseValues,
          )).rows[0]?.count;
      const query = materializeAssetCardPageQuery(pageRequest, {
        resourceVersion: version.version,
        snapshotAt: version.snapshotAt,
        totalItems,
      });
      const values = [...baseValues];
      if (query.cursor && query.comparison) {
        values.push(query.cursor.timestamp, query.cursor.id);
        conditions.push(
          `(created_at, id) ${query.comparison} ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
        );
      }
      values.push(query.limit + 1);
      const result = await client.query<AssetCardRow & ExactPageMetadata>(
      `SELECT id, name, type, source, folder_id, object_key, thumbnail_key, thumbnail_status,
              size_bytes, duration_seconds, width, height, views,
              downloaded_at, download_requested_at, created_at, updated_at,
              ${exactPageMetadataColumns('created_at')}
       FROM assets
       WHERE ${conditions.join('\n         AND ')}
       ORDER BY created_at ${query.queryOrder}, id ${query.queryOrder}
       LIMIT $${values.length}`,
      values,
    );
      const displayRows = selectExactCursorPageRows(result.rows, query);
      const cards = await mapAssetCardRows(displayRows);
      const cardsById = new Map(cards.map(card => [card.id, card]));
      request.log.info({
        event: 'asset-card-page',
        itemCount: cards.length,
        thumbnailSignatureCandidates: new Set(
          displayRows
            .filter(row => row.thumbnail_status === 'ready' && row.thumbnail_key && row.thumbnail_key !== row.object_key)
            .map(row => row.thumbnail_key),
        ).size,
        position: query.position,
      }, '资产卡片分页完成');
      return createAssetCardPage({
        rows: result.rows,
        query,
        map: row => cardsById.get(row.id)!,
      });
    });
  });

  app.get('/api/assets/summary', async request => {
    const user = await requireAuth(request);
    const [totals, folders] = await Promise.all([
      pool.query<AssetSummaryRow>(
        `SELECT count(*)::integer AS total,
                count(*) FILTER (WHERE type = 'video')::integer AS video_count,
                count(*) FILTER (WHERE type = 'image')::integer AS image_count,
                count(*) FILTER (WHERE type = 'audio')::integer AS audio_count,
                count(*) FILTER (WHERE source = 'ai-video')::integer AS ai_video_count,
                count(*) FILTER (WHERE source = 'ai-image')::integer AS ai_image_count,
                count(*) FILTER (WHERE source = 'uploaded-video')::integer AS uploaded_video_count,
                count(*) FILTER (WHERE source = 'uploaded-image')::integer AS uploaded_image_count,
                count(*) FILTER (WHERE source = 'uploaded-audio')::integer AS uploaded_audio_count,
                count(*) FILTER (
                  WHERE COALESCE(download_requested_at, downloaded_at) IS NOT NULL
                )::integer AS downloaded_count
         FROM assets
         WHERE user_id = $1 AND deletion_status = 'active'`,
        [user.id],
      ),
      pool.query<AssetFolderCountRow>(
        `SELECT folder_id, count(*)::integer AS count
         FROM assets
         WHERE user_id = $1 AND deletion_status = 'active'
         GROUP BY folder_id
         ORDER BY folder_id NULLS FIRST`,
        [user.id],
      ),
    ]);
    const row = totals.rows[0] ?? emptyAssetSummaryRow();
    const total = Number(row.total);
    const downloaded = Number(row.downloaded_count);
    return {
      summary: {
        total,
        byType: {
          video: Number(row.video_count),
          image: Number(row.image_count),
          audio: Number(row.audio_count),
        },
        bySource: {
          'ai-video': Number(row.ai_video_count),
          'ai-image': Number(row.ai_image_count),
          'uploaded-video': Number(row.uploaded_video_count),
          'uploaded-image': Number(row.uploaded_image_count),
          'uploaded-audio': Number(row.uploaded_audio_count),
        },
        downloaded,
        notDownloaded: Math.max(0, total - downloaded),
        folderCounts: folders.rows.map(item => ({
          folderId: item.folder_id,
          count: Number(item.count),
        })),
      },
    };
  });

  app.get('/api/assets/folders', async request => {
    const user = await requireAuth(request);
    const query = endpointContracts.assetFolders.query.parse(request.query);
    const result = await pool.query<AssetFolderRow>(
      `SELECT * FROM asset_folders
       WHERE user_id = $1 AND ($2::text IS NULL OR source = $2)
       ORDER BY is_system DESC, created_at DESC, id DESC`,
      [user.id, query.source ?? null],
    );

    return {
      items: result.rows.map(mapFolder),
    };
  });

  app.post('/api/assets/folders', async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.assetFolderCreate.body.parse(request.body);
    const result = await pool.query<AssetFolderRow>(
      `INSERT INTO asset_folders (user_id, name, source, is_system)
       VALUES ($1, $2, $3, false)
       RETURNING *`,
      [user.id, payload.name, payload.source],
    );

    return { folder: mapFolder(result.rows[0]) };
  });

  app.patch('/api/assets/folders/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetFolderRename.params.parse(request.params);
    const payload = endpointContracts.assetFolderRename.body.parse(request.body);
    const result = await pool.query<AssetFolderRow>(
      `UPDATE asset_folders
       SET name = $3
       WHERE id = $1 AND user_id = $2 AND is_system = false
       RETURNING *`,
      [id, user.id, payload.name],
    );
    if (!result.rowCount) throw Object.assign(new Error('文件夹不存在或不可修改'), { statusCode: 404 });

    return { folder: mapFolder(result.rows[0]) };
  });

  app.delete('/api/assets/folders/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetFolderDelete.params.parse(request.params);
    const { contentAction: requestedAction } = endpointContracts.assetFolderDelete.query.parse(request.query);
    const result = await withTransaction<AssetFolderDeleteResultDto>(async client => {
      const folder = await client.query<{ id: string; source: string }>(
        `SELECT id, source
         FROM asset_folders
         WHERE id = $1 AND user_id = $2 AND is_system = false
         FOR UPDATE`,
        [id, user.id],
      );
      if (!folder.rowCount) {
        const deleted = await client.query<AssetFolderDeletionRecordRow>(
          `SELECT content_action, affected_asset_count
           FROM asset_folder_deletion_records
           WHERE folder_id = $1 AND user_id = $2
           LIMIT 1`,
          [id, user.id],
        );
        if (deleted.rowCount) {
          const record = deleted.rows[0]!;
          const recordedAction = record.content_action ?? 'delete-assets';
          if (requestedAction && requestedAction !== recordedAction) {
            throw folderDeleteActionConflict(recordedAction);
          }
          return {
            ok: true,
            contentAction: recordedAction,
            affectedAssetCount: record.affected_asset_count === null
              || record.affected_asset_count === undefined
              ? null
              : Number(record.affected_asset_count),
          };
        }
        throw Object.assign(new Error('文件夹不存在或不可删除'), { statusCode: 404 });
      }

      const contentAction = requestedAction ?? 'move-to-root';
      const rootFolderId = await resolveAssetFolderId(client, {
        userId: user.id,
        source: folder.rows[0]!.source,
        folderId: null,
      });
      // 目录锁已在上方取得；随后锁住所有仍可能封口的会话。上传持久化也按
      // “目录 → 会话”取锁，因此并发封口会在事务边界上串行化，不会产生
      // 指向已删除目录的迟到活动资产。这里锁住目录内全部会话，保证同一
      // 快照内把可恢复会话迁回主目录、终态历史会话脱钩。
      await client.query(
        `SELECT id
         FROM upload_sessions
         WHERE folder_id = $1
           AND user_id = $2
         ORDER BY id
         FOR UPDATE`,
        [id, user.id],
      );
      let affectedAssetCount: number;
      if (contentAction === 'move-to-root') {
        const moved = await client.query<{ id: string }>(
          `UPDATE assets
           SET folder_id = $3, updated_at = now()
           WHERE folder_id = $1 AND user_id = $2 AND deletion_status = 'active'
           RETURNING id`,
          [id, user.id, rootFolderId],
        );
        affectedAssetCount = moved.rowCount ?? moved.rows.length;
      } else {
        const assets = await client.query<{ id: string }>(
          `SELECT id
           FROM assets
           WHERE folder_id = $1 AND user_id = $2 AND deletion_status = 'active'
           FOR UPDATE`,
          [id, user.id],
        );
        affectedAssetCount = await scheduleAssetDeletion(
          client,
          user.id,
          assets.rows.map(asset => asset.id),
        );
      }

      await client.query(
        `UPDATE upload_sessions
         SET folder_id = $3, updated_at = now()
         WHERE folder_id = $1
           AND user_id = $2
           AND (
             status IN ('pending', 'processing')
             OR (status = 'failed' AND retryable = true AND retention_until > now())
           )`,
        [id, user.id, rootFolderId],
      );
      // completed/canceled/expired 与不可再重试的 failed 只保留历史身份，
      // 不应伪装为在主目录完成；在旧目录仍存在时显式置空，供 077 的受控
      // 身份触发器验证，随后 FK 删除不再产生隐式级联更新。
      await client.query(
        `UPDATE upload_sessions
         SET folder_id = NULL, updated_at = now()
         WHERE folder_id = $1
           AND user_id = $2
           AND (
             status IN ('completed', 'canceled', 'expired')
             OR (
               status = 'failed'
               AND NOT (retryable = true AND retention_until > now())
             )
           )`,
        [id, user.id],
      );
      await client.query(
        `UPDATE assets SET folder_id = NULL, updated_at = now()
         WHERE folder_id = $1 AND user_id = $2`,
        [id, user.id],
      );
      await client.query(
        `INSERT INTO asset_folder_deletion_records (
           user_id, folder_id, content_action, affected_asset_count
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, folder_id) DO NOTHING`,
        [user.id, id, contentAction, affectedAssetCount],
      );
      await client.query('DELETE FROM asset_folders WHERE id = $1 AND user_id = $2', [id, user.id]);
      return { ok: true, contentAction, affectedAssetCount };
    });

    return result;
  });

  app.post('/api/assets/upload-signature', async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.assetUploadSignature.body.parse(request.body);
    return createOrReplayUploadSession(user.id, payload);
  });

  app.post('/api/assets/complete-upload', async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.assetUploadComplete.body.parse(request.body);
    return { session: await queueUploadCompletion(user.id, payload.uploadSessionId) };
  });

  app.get('/api/assets/upload-sessions/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetUploadSession.params.parse(request.params);
    return { session: await getOwnedUploadSession(user.id, id) };
  });

  app.post('/api/assets/upload-sessions/:id/cancel', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetUploadSessionCancel.params.parse(request.params);
    return { session: await cancelOwnedUploadSession(user.id, id) };
  });

  app.post('/api/assets/upload-sessions/:id/retry', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetUploadSessionRetry.params.parse(request.params);
    return { session: await retryOwnedUploadSession(user.id, id) };
  });

  app.get('/api/assets/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetDetail.params.parse(request.params);
    const result = await pool.query<AssetRow>(
      `SELECT * FROM assets
       WHERE id = $1 AND user_id = $2 AND deletion_status = 'active'
       LIMIT 1`,
      [id, user.id],
    );
    if (!result.rowCount) throw Object.assign(new Error('素材不存在'), { statusCode: 404 });
    return { asset: await mapAssetDetailRow(result.rows[0]!) };
  });

  app.patch('/api/assets/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetUpdate.params.parse(request.params);
    const payload = endpointContracts.assetUpdate.body.parse(request.body);
    const result = await withTransaction(async client => {
      if (payload.folderId === undefined) {
        const current = await client.query<AssetRow>(
          `SELECT * FROM assets
           WHERE id = $1 AND user_id = $2 AND deletion_status = 'active'
           FOR UPDATE`,
          [id, user.id],
        );
        if (!current.rowCount) throw Object.assign(new Error('素材不存在'), { statusCode: 404 });
        const row = current.rows[0]!;
        return client.query<AssetRow>(
          `UPDATE assets
           SET name = $3, updated_at = now()
           WHERE id = $1 AND user_id = $2 AND deletion_status = 'active'
           RETURNING *`,
          [id, user.id, payload.name ?? row.name],
        );
      }

      // 移动必须统一按“目标目录 → 素材”取锁，避免与删除目录的
      // “目录 → 素材”顺序形成环。首次读取不持锁，只用于确定来源。
      const observed = await client.query<{ id: string; source: string }>(
        `SELECT id, source FROM assets
         WHERE id = $1 AND user_id = $2 AND deletion_status = 'active'`,
        [id, user.id],
      );
      if (!observed.rowCount) throw Object.assign(new Error('素材不存在'), { statusCode: 404 });
      const observedSource = observed.rows[0]!.source;
      const folderId = await resolveAssetFolderId(client, {
        userId: user.id,
        folderId: payload.folderId,
        source: observedSource,
      });
      const current = await client.query(
        `SELECT * FROM assets
         WHERE id = $1 AND user_id = $2 AND deletion_status = 'active'
         FOR UPDATE`,
        [id, user.id],
      );
      if (!current.rowCount) throw Object.assign(new Error('素材不存在'), { statusCode: 404 });
      const row = current.rows[0]!;
      if (row.source !== observedSource) throw assetMoveRaceConflict();
      return client.query<AssetRow>(
        `UPDATE assets
         SET name = $3, folder_id = $4, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND deletion_status = 'active'
         RETURNING *`,
        [id, user.id, payload.name ?? row.name, folderId],
      );
    });

    return { asset: await mapAssetCardRow(result.rows[0]) };
  });

  app.post('/api/assets/:id/download', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetDownloadRequest.params.parse(request.params);
    const download = await prepareOwnedAssetDownload(id, user.id);

    return {
      download: {
        url: download.url,
        filename: download.filename,
        downloadRequestedAt: toIsoDateTime(download.downloadRequestedAt),
      },
    };
  });

  app.get('/api/assets/:id/download', async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetDownloadRequest.params.parse(request.params);
    const download = await prepareOwnedAssetDownload(id, user.id);

    return reply.redirect(download.url, 302);
  });

  app.delete('/api/assets/:id', async request => {
    const user = await requireAuth(request);
    const { id } = endpointContracts.assetDelete.params.parse(request.params);
    await withTransaction(async client => {
      const count = await scheduleAssetDeletion(client, user.id, [id]);
      if (count !== 1 && !(await userOwnsAllAssets(client, user.id, [id]))) {
        throw Object.assign(new Error('素材不存在'), { statusCode: 404 });
      }
    });
    return { ok: true };
  });

  app.post('/api/assets/bulk-move', async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.assetsBulkMove.body.parse(request.body);
    const movedAssets = await withTransaction(async client => {
      const uniqueIds = Array.from(new Set(payload.assetIds)).sort();
      // 先无锁观察来源，再按来源稳定排序锁目标目录；最后才锁素材并重验。
      const observed = await client.query<{ id: string; source: string }>(
        `SELECT id, source FROM assets
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deletion_status = 'active'
         ORDER BY id ASC`,
        [user.id, uniqueIds],
      );
      if (observed.rowCount !== uniqueIds.length) {
        throw Object.assign(new Error('部分素材不存在或不属于当前用户'), { statusCode: 404 });
      }
      const sources = [...new Set(observed.rows.map(asset => asset.source))].sort();
      const targetFolderIds = new Map<string, string>();
      if (payload.folderId) {
        if (sources.length !== 1) {
          throw Object.assign(new Error('不同来源的素材不能移入同一文件夹'), { statusCode: 400 });
        }
        const source = sources[0]!;
        const folderId = await resolveAssetFolderId(client, {
          userId: user.id,
          folderId: payload.folderId,
          source,
        });
        targetFolderIds.set(source, folderId);
      } else {
        for (const source of sources) {
          targetFolderIds.set(source, await resolveAssetFolderId(client, {
            userId: user.id,
            folderId: null,
            source,
          }));
        }
      }

      const assets = await client.query<{ id: string; source: string }>(
        `SELECT id, source FROM assets
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deletion_status = 'active'
         ORDER BY id ASC
         FOR UPDATE`,
        [user.id, uniqueIds],
      );
      if (assets.rowCount !== uniqueIds.length || !sameAssetSources(observed.rows, assets.rows)) {
        throw assetMoveRaceConflict();
      }
      const moved: AssetRow[] = [];
      for (const source of sources) {
        const sourceAssetIds = assets.rows
          .filter(asset => asset.source === source)
          .map(asset => asset.id);
        const folderId = targetFolderIds.get(source)!;
        const result = await client.query<AssetRow>(
          `UPDATE assets
           SET folder_id = $3, updated_at = now()
           WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deletion_status = 'active'
           RETURNING *`,
          [user.id, sourceAssetIds, folderId],
        );
        moved.push(...result.rows);
      }
      return moved;
    });

    return { items: await mapAssetCardRows(movedAssets) };
  });

  app.post('/api/assets/bulk-delete', async request => {
    const user = await requireAuth(request);
    const payload = endpointContracts.assetsBulkDelete.body.parse(request.body);
    await withTransaction(async client => {
      const uniqueIds = Array.from(new Set(payload.assetIds));
      const count = await scheduleAssetDeletion(client, user.id, uniqueIds);
      if (count !== uniqueIds.length && !(await userOwnsAllAssets(client, user.id, uniqueIds))) {
        throw Object.assign(new Error('部分素材不存在或不属于当前用户'), { statusCode: 404 });
      }
    });
    return { ok: true };
  });

}

async function userOwnsAllAssets(client: DbClient, userId: string, assetIds: string[]) {
  const result = await client.query<{ count: number | string }>(
    `SELECT count(*)::integer AS count
     FROM assets
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, assetIds],
  );
  return Number(result.rows[0]?.count ?? 0) === assetIds.length;
}

function mapFolder(row: AssetFolderRow) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    isSystem: Boolean(row.is_system),
    createdAt: toIsoDateTime(row.created_at),
  };
}

function folderDeleteActionConflict(recordedAction: AssetFolderContentAction) {
  return Object.assign(new Error('文件夹已按不同的内容处理方式删除'), {
    statusCode: 409,
    code: 'ASSET_FOLDER_DELETE_ACTION_CONFLICT',
    recordedAction,
  });
}

function assetMoveRaceConflict() {
  return Object.assign(new Error('素材位置已变化，请刷新后重试'), {
    statusCode: 409,
    code: 'ASSET_MOVE_RACE_CONFLICT',
  });
}

function sameAssetSources(
  observed: Array<{ id: string; source: string }>,
  locked: Array<{ id: string; source: string }>,
) {
  if (observed.length !== locked.length) return false;
  const lockedSources = new Map(locked.map(asset => [asset.id, asset.source]));
  return observed.every(asset => lockedSources.get(asset.id) === asset.source);
}

function emptyAssetSummaryRow(): AssetSummaryRow {
  return {
    total: 0,
    video_count: 0,
    image_count: 0,
    audio_count: 0,
    ai_video_count: 0,
    ai_image_count: 0,
    uploaded_video_count: 0,
    uploaded_image_count: 0,
    uploaded_audio_count: 0,
    downloaded_count: 0,
  };
}
