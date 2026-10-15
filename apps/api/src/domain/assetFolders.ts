import type { DbClient } from '../db/pool.js';

export const DEFAULT_ASSET_FOLDERS = [
  { name: 'AI 视频', source: 'ai-video' },
  { name: 'AI 图片', source: 'ai-image' },
  { name: '已上传视频', source: 'uploaded-video' },
  { name: '已上传图片', source: 'uploaded-image' },
  { name: '已上传音频', source: 'uploaded-audio' },
] as const;

export async function ensureDefaultAssetFolders(client: DbClient, userId: string) {
  for (const folder of DEFAULT_ASSET_FOLDERS) {
    await client.query(
      `INSERT INTO asset_folders (user_id, name, source, is_system)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (user_id, source) WHERE is_system
       DO NOTHING`,
      [userId, folder.name, folder.source],
    );
  }
}

export async function resolveAssetFolderId(
  client: DbClient,
  input: {
    userId: string;
    source: string;
    folderId?: string | null;
  },
) {
  if (input.folderId) {
    const folder = await client.query<{ id: string }>(
      `SELECT id FROM asset_folders
       WHERE id = $1 AND user_id = $2 AND source = $3
       LIMIT 1
       FOR KEY SHARE`,
      [input.folderId, input.userId, input.source],
    );
    if (!folder.rowCount) {
      throw Object.assign(new Error('目标文件夹不存在、不属于当前用户或来源不匹配'), {
        statusCode: 400,
        code: 'ASSET_FOLDER_INVALID',
      });
    }
    return folder.rows[0]!.id;
  }

  const rootFolder = await client.query<{ id: string }>(
    `SELECT id FROM asset_folders
     WHERE user_id = $1 AND source = $2 AND is_system = true
     ORDER BY created_at ASC, id ASC
     LIMIT 1
     FOR KEY SHARE`,
    [input.userId, input.source],
  );
  if (!rootFolder.rowCount) {
    throw Object.assign(new Error('素材系统主目录缺失，请联系管理员'), {
      statusCode: 500,
      code: 'ASSET_ROOT_FOLDER_MISSING',
    });
  }
  return rootFolder.rows[0]!.id;
}
