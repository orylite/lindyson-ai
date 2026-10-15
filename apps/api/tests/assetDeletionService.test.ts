import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  transactionQuery: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  withTransaction: mocks.withTransaction,
}));

vi.mock('../src/storage/storageService.js', () => ({
  deleteObject: mocks.deleteObject,
}));

import {
  processObjectDeletionOutbox,
  scheduleAssetDeletion,
  scheduleSystemAssetDeletion,
  sweepExpiredUploadSessions,
} from '../src/domain/assetDeletionService.js';

describe('assetDeletionService', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
    mocks.transactionQuery.mockReset();
    mocks.deleteObject.mockReset();
    mocks.deleteObject.mockResolvedValue(undefined);
  });

  it('事务内先标记 deleting 并写 outbox，不在提交前删对象', async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
        const query = String(sql);
        calls.push(query);
        if (query.includes('SELECT id, object_key, thumbnail_key')) {
          return queryResult([{
            id: '00000000-0000-4000-8000-000000000001',
            object_key: 'objects/video.mp4',
            thumbnail_key: 'objects/video.jpg',
          }]);
        }
        if (query.includes('id <> ALL')) return queryResult([]);
        return queryResult([]);
      }),
    };

    await expect(scheduleAssetDeletion(
      client as never,
      '00000000-0000-4000-8000-000000000010',
      ['00000000-0000-4000-8000-000000000001'],
    )).resolves.toBe(1);

    expect(calls.findIndex(query => query.includes("deletion_status = 'deleting'")))
      .toBeLessThan(calls.findIndex(query => query.includes('INSERT INTO object_deletion_outbox')));
    const lockCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('pg_advisory_xact_lock'));
    expect(lockCalls).toEqual([
      [expect.stringContaining('pg_advisory_xact_lock'), ['asset-object:objects/video.jpg']],
      [expect.stringContaining('pg_advisory_xact_lock'), ['asset-object:objects/video.mp4']],
    ]);
    const lastLockIndex = Math.max(...calls.map((query, index) => query.includes('pg_advisory_xact_lock') ? index : -1));
    expect(lastLockIndex).toBeLessThan(calls.findIndex(query => query.includes('INSERT INTO object_deletion_outbox')));
    expect(calls.filter(query => query.includes('INSERT INTO object_deletion_outbox'))).toHaveLength(2);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('outbox 工作器完成幂等对象删除后才将资产标记 deleted', async () => {
    let claimed = false;
    mocks.transactionQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('WITH next_item')) {
        if (claimed) return queryResult([]);
        claimed = true;
        return queryResult([{
          id: 'outbox-1',
          object_key: 'objects/video.mp4',
          asset_ids: ['00000000-0000-4000-8000-000000000001'],
          claim_token: '00000000-0000-4000-8000-000000000099',
        }]);
      }
      if (query.includes('WHERE id = $1 AND claim_token = $2') && query.includes('lease_expires_at > now()')) {
        return queryResult([{ '?column?': 1 }]);
      }
      if (query.includes('UNION ALL') && query.includes('generation_provider_runs')) {
        expect(query).toContain("deletion_status = 'active'");
        expect(query).not.toContain("deletion_status IN ('active', 'deleting')");
        return queryResult([]);
      }
      if (query.includes('SET status = $3')) return queryResult([{ id: 'outbox-1' }]);
      return queryResult([]);
    });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.transactionQuery }));

    await expect(processObjectDeletionOutbox(2)).resolves.toEqual({ completed: 1, skipped: 0, failed: 0 });
    expect(mocks.deleteObject).toHaveBeenCalledWith('objects/video.mp4');
    const ownershipQuery = mocks.transactionQuery.mock.calls.find(([sql]) => (
      String(sql).includes('lease_expires_at > now()')
    ));
    expect(String(ownershipQuery?.[0])).toContain('FOR UPDATE');
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET deletion_status = 'deleted'"),
      [['00000000-0000-4000-8000-000000000001']],
    );
  });

  it('系统跨用户批量删除会对共享对象建立一条包含全部资产的 Outbox', async () => {
    const firstAssetId = '00000000-0000-4000-8000-000000000001';
    const secondAssetId = '00000000-0000-4000-8000-000000000002';
    const client = {
      query: vi.fn(async (sql: unknown, _params?: unknown[]) => {
        const query = String(sql);
        if (query.includes('FROM unnest')) {
          return queryResult([
            { id: firstAssetId, object_key: 'objects/shared.mp4', thumbnail_key: 'objects/first.jpg' },
            { id: secondAssetId, object_key: 'objects/shared.mp4', thumbnail_key: 'objects/second.jpg' },
          ]);
        }
        if (query.includes('SELECT object_key, thumbnail_key') && query.includes('id <> ALL')) return queryResult([]);
        return queryResult([]);
      }),
    };

    await expect(scheduleSystemAssetDeletion(client as never, [
      { id: firstAssetId, userId: '00000000-0000-4000-8000-000000000011' },
      { id: secondAssetId, userId: '00000000-0000-4000-8000-000000000012' },
    ])).resolves.toBe(2);

    const outboxCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO object_deletion_outbox'));
    expect(outboxCalls).toHaveLength(3);
    expect(outboxCalls).toContainEqual([
      expect.stringContaining('INSERT INTO object_deletion_outbox'),
      ['objects/shared.mp4', [firstAssetId, secondAssetId], null],
    ]);
    const lockKeys = client.query.mock.calls
      .filter(([sql]) => String(sql).includes('pg_advisory_xact_lock'))
      .map(([, values]) => values?.[0]);
    expect(lockKeys).toEqual([
      'asset-object:objects/first.jpg',
      'asset-object:objects/second.jpg',
      'asset-object:objects/shared.mp4',
    ]);
  });

  it('跨批次共享主文件会重复 upsert Outbox 并合并各批资产归属', async () => {
    const firstAssetId = '00000000-0000-4000-8000-000000000021';
    const secondAssetId = '00000000-0000-4000-8000-000000000022';
    let targetRead = 0;
    const client = {
      query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
        const query = String(sql);
        if (query.includes('FROM unnest')) {
          targetRead += 1;
          return targetRead === 1
            ? queryResult([{ id: firstAssetId, object_key: 'objects/shared.mp4', thumbnail_key: 'objects/first.jpg' }])
            : queryResult([{ id: secondAssetId, object_key: 'objects/shared.mp4', thumbnail_key: 'objects/second.jpg' }]);
        }
        return queryResult([]);
      }),
    };

    await scheduleSystemAssetDeletion(client as never, [
      { id: firstAssetId, userId: '00000000-0000-4000-8000-000000000031' },
    ]);
    await scheduleSystemAssetDeletion(client as never, [
      { id: secondAssetId, userId: '00000000-0000-4000-8000-000000000032' },
    ]);

    const sharedOutboxCalls = client.query.mock.calls.filter(([sql, values]) => (
      String(sql).includes('INSERT INTO object_deletion_outbox') && values?.[0] === 'objects/shared.mp4'
    ));
    expect(sharedOutboxCalls).toEqual([
      [expect.stringContaining('ON CONFLICT (object_key) DO UPDATE'), ['objects/shared.mp4', [firstAssetId], null]],
      [expect.stringContaining('ON CONFLICT (object_key) DO UPDATE'), ['objects/shared.mp4', [secondAssetId], null]],
    ]);
  });

  it('对象仍被活跃资产或任务引用时以 skipped 终止且不删除物理对象', async () => {
    let claimed = false;
    mocks.transactionQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('WITH next_item')) {
        if (claimed) return queryResult([]);
        claimed = true;
        return queryResult([{
          id: 'outbox-live', object_key: 'objects/shared.mp4', asset_ids: [],
          claim_token: '00000000-0000-4000-8000-000000000099',
        }]);
      }
      if (query.includes('lease_expires_at > now()')) return queryResult([{ '?column?': 1 }]);
      if (query.includes('UNION ALL') && query.includes('generation_provider_runs')) return queryResult([{ '?column?': 1 }]);
      if (query.includes('SET status = $3')) return queryResult([{ id: 'outbox-live' }]);
      return queryResult([]);
    });
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.transactionQuery }));

    await expect(processObjectDeletionOutbox(1)).resolves.toEqual({ completed: 0, skipped: 1, failed: 0 });
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET status = $3'),
      ['outbox-live', '00000000-0000-4000-8000-000000000099', 'skipped'],
    );
  });

  it('迁移将历史任务和积分流水的资产外键改为 ON DELETE SET NULL', async () => {
    const migration = await readFile(new URL('../migrations/021_generation_storage.sql', import.meta.url), 'utf8');
    expect(migration).toMatch(/generation_tasks_asset_id_fkey[\s\S]*ON DELETE SET NULL/);
    expect(migration).toMatch(/credit_ledger_asset_fk[\s\S]*ON DELETE SET NULL/);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS object_deletion_outbox');
  });

  it('047 强制上传状态与阶段、重试和封口字段保持一致', async () => {
    const migration = await readFile(new URL('../migrations/047_state_machine_invariants.sql', import.meta.url), 'utf8');
    expect(migration).toContain('upload_sessions_status_stage_check');
    expect(migration).toContain('upload_sessions_retryable_state_check');
    expect(migration).toContain('upload_sessions_sealed_state_check');
    expect(migration).toMatch(/status = 'pending' AND processing_stage IN \('waiting-upload', 'queued'\)/);
  });

  it('过期上传会话通过 skip locked 分页标记并将孤儿对象写入 outbox', async () => {
    mocks.transactionQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes('UPDATE upload_sessions')) {
        return queryResult([{
          id: 'session-1', object_key: 'users/user-1/orphan.mp4', final_object_key: null, thumbnail_key: null,
        }]);
      }
      if (query.includes('SELECT id FROM assets')) return queryResult([]);
      if (query.includes('INSERT INTO object_deletion_outbox')) return queryResult([]);
      throw new Error(`未预期的查询：${query}`);
    });
    mocks.withTransaction.mockImplementation(async (callback: (client: { query: typeof mocks.transactionQuery }) => unknown) => (
      callback({ query: mocks.transactionQuery })
    ));

    await expect(sweepExpiredUploadSessions(25)).resolves.toBe(1);
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      [25],
    );
    expect(String(mocks.transactionQuery.mock.calls[0]?.[0])).toContain("processing_stage = 'waiting-upload'");
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO object_deletion_outbox'),
      ['users/user-1/orphan.mp4', [], null],
    );
  });

});

function queryResult(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}
