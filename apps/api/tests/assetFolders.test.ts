import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import {
  DEFAULT_ASSET_FOLDERS,
  ensureDefaultAssetFolders,
  resolveAssetFolderId,
} from '../src/domain/assetFolders.js';

describe('素材系统主目录', () => {
  it.each([null, undefined])('folderId=%s 时解析为当前用户和来源的系统主目录', async folderId => {
    const client = mockClient([{ id: 'root-folder-id' }]);

    await expect(resolveAssetFolderId(client, {
      userId: 'user-1',
      source: 'uploaded-image',
      folderId,
    })).resolves.toBe('root-folder-id');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/is_system = true[\s\S]*FOR KEY SHARE/),
      ['user-1', 'uploaded-image'],
    );
  });

  it('显式文件夹必须同时匹配用户和来源', async () => {
    const client = mockClient([]);

    await expect(resolveAssetFolderId(client, {
      userId: 'user-1',
      source: 'uploaded-video',
      folderId: 'folder-from-other-source',
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'ASSET_FOLDER_INVALID',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/id = \$1 AND user_id = \$2 AND source = \$3[\s\S]*FOR KEY SHARE/),
      ['folder-from-other-source', 'user-1', 'uploaded-video'],
    );
  });

  it('系统主目录缺失时中止写入而不是返回 null', async () => {
    const client = mockClient([]);

    await expect(resolveAssetFolderId(client, {
      userId: 'user-1',
      source: 'ai-video',
      folderId: null,
    })).rejects.toMatchObject({
      statusCode: 500,
      code: 'ASSET_ROOT_FOLDER_MISSING',
    });
  });

  it('默认目录初始化依赖部分唯一索引实现并发幂等', async () => {
    const client = mockClient([]);

    await ensureDefaultAssetFolders(client, 'user-1');

    expect(client.query).toHaveBeenCalledTimes(DEFAULT_ASSET_FOLDERS.length);
    for (const folder of DEFAULT_ASSET_FOLDERS) {
      expect(client.query).toHaveBeenCalledWith(
        expect.stringMatching(/ON CONFLICT \(user_id, source\) WHERE is_system\s+DO NOTHING/),
        ['user-1', folder.name, folder.source],
      );
    }
  });
});

describe('素材文件夹不变量迁移', () => {
  it('先合并全部资产引用，再建立唯一索引和活动素材非空约束', async () => {
    const migration = await readFile(
      new URL('../migrations/035_asset_folder_invariants.sql', import.meta.url),
      'utf8',
    );

    const updateReferencesAt = migration.indexOf('WHERE assets.folder_id = merge_map.duplicate_id');
    const deleteDuplicatesAt = migration.indexOf('WHERE folders.id = merge_map.duplicate_id');
    expect(updateReferencesAt).toBeGreaterThan(-1);
    expect(deleteDuplicatesAt).toBeGreaterThan(updateReferencesAt);
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_folders_unique_system_source');
    expect(migration).toContain("CHECK (deletion_status <> 'active' OR folder_id IS NOT NULL)");
    expect(migration).toContain('VALIDATE CONSTRAINT assets_active_folder_required');
  });
});

function mockClient(rows: Array<{ id: string }>) {
  const query = vi.fn(async () => ({ rowCount: rows.length, rows }));
  return { query } as unknown as DbClient & { query: typeof query };
}
