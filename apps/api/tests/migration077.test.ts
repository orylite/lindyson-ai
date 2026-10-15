import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('077 素材文件夹删除模式迁移', () => {
  it('把历史墓碑标记为 delete-assets，同时保留未知影响数量', async () => {
    const migration = await readFile(
      new URL('../migrations/077_asset_folder_delete_modes.sql', import.meta.url),
      'utf8',
    );

    const addColumnsAt = migration.indexOf('ADD COLUMN IF NOT EXISTS content_action text');
    const backfillAt = migration.indexOf("SET content_action = 'delete-assets'");
    const requireActionAt = migration.indexOf('ALTER COLUMN content_action SET NOT NULL');
    expect(addColumnsAt).toBeGreaterThan(-1);
    expect(backfillAt).toBeGreaterThan(addColumnsAt);
    expect(requireActionAt).toBeGreaterThan(backfillAt);
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS affected_asset_count integer');
    expect(migration).not.toMatch(/SET\s+affected_asset_count\s*=/);
    expect(migration).toContain("CHECK (content_action IN ('move-to-root', 'delete-assets'))");
    expect(migration).toContain('affected_asset_count IS NULL OR affected_asset_count >= 0');
  });

  it('重建上传会话目录约束：可恢复会话必须有目录，终态历史可脱钩', async () => {
    const migration = await readFile(
      new URL('../migrations/077_asset_folder_delete_modes.sql', import.meta.url),
      'utf8',
    );

    const dropAt = migration.indexOf(
      'DROP CONSTRAINT IF EXISTS upload_sessions_source_required_check',
    );
    const addAt = migration.indexOf(
      'ADD CONSTRAINT upload_sessions_source_required_check',
    );
    expect(dropAt).toBeGreaterThan(-1);
    expect(addAt).toBeGreaterThan(dropAt);
    expect(migration).toMatch(
      /source IS NOT NULL AND asset_type IS NOT NULL AND final_object_key IS NOT NULL/,
    );
    expect(migration).toMatch(/folder_id IS NOT NULL\s+OR status IN \('completed', 'canceled'\)/);
    expect(migration).toMatch(
      /status = 'failed'\s+AND NOT \(retryable = true AND retention_until > now\(\)\)/,
    );
    expect(migration).toMatch(/status = 'expired'\s+OR/);
  });

  it('只放开受控的普通目录迁主目录与终态目录脱钩，其他身份仍不可变', async () => {
    const migration = await readFile(
      new URL('../migrations/077_asset_folder_delete_modes.sql', import.meta.url),
      'utf8',
    );

    const identityFunction = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION preserve_upload_session_identity()'),
    );
    expect(identityFunction).toContain('NEW.folder_id IS DISTINCT FROM OLD.folder_id');
    expect(identityFunction).toMatch(/OLD\.status IN \('pending', 'processing'\)/);
    expect(identityFunction).toMatch(/NEW\.status IN \('pending', 'processing'\)/);
    expect(identityFunction).toMatch(/OLD\.retryable = true[\s\S]*OLD\.retention_until > now\(\)/);
    expect(identityFunction).toMatch(/NEW\.retryable = true[\s\S]*NEW\.retention_until > now\(\)/);
    expect(identityFunction).toContain('old_folder.user_id = OLD.user_id');
    expect(identityFunction).toContain('new_folder.user_id = OLD.user_id');
    expect(identityFunction).toContain('old_folder.source = OLD.source');
    expect(identityFunction).toContain('new_folder.source = OLD.source');
    expect(identityFunction).toContain('old_folder.is_system = false');
    expect(identityFunction).toContain('new_folder.is_system = true');
    expect(identityFunction).toMatch(/NEW\.folder_id IS NULL[\s\S]*OLD\.status IN \('completed', 'canceled', 'expired'\)/);

    const immutableTuple = identityFunction.slice(
      identityFunction.indexOf('IF ROW('),
      identityFunction.indexOf(') THEN', identityFunction.indexOf('IF ROW(')),
    );
    for (const field of [
      'user_id',
      'object_key',
      'filename',
      'content_type',
      'max_size_bytes',
      'idempotency_key',
      'request_hash',
      'source',
      'asset_type',
      'asset_name',
      'final_object_key',
    ]) {
      expect(immutableTuple).toContain(`NEW.${field}`);
      expect(immutableTuple).toContain(`OLD.${field}`);
    }
    expect(immutableTuple).not.toContain('folder_id');
    expect(identityFunction).toMatch(
      /DROP TRIGGER IF EXISTS upload_sessions_preserve_identity[\s\S]*CREATE TRIGGER upload_sessions_preserve_identity/,
    );
  });
});
