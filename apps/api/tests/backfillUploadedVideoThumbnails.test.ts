import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  transactionQuery: vi.fn(),
  createUploadedVideoPreview: vi.fn(),
  isUserUploadedObjectKey: vi.fn(),
  scheduleObjectDeletion: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.connect,
    end: vi.fn(),
  },
  withTransaction: vi.fn(async (run: (client: { query: typeof mocks.transactionQuery }) => unknown) => (
    run({ query: mocks.transactionQuery })
  )),
}));

vi.mock('../src/domain/assetDeletionService.js', () => ({
  scheduleObjectDeletion: mocks.scheduleObjectDeletion,
}));

vi.mock('../src/domain/uploadedVideoPreview.js', async () => {
  const actual = await vi.importActual<typeof import('../src/domain/uploadedVideoPreview.js')>(
    '../src/domain/uploadedVideoPreview.js',
  );
  return {
    ...actual,
    buildHistoricalVideoThumbnailKey: (userId: string, assetId: string) => (
      `users/${userId}/asset-thumbnails/${assetId}.jpg`
    ),
    createUploadedVideoPreview: mocks.createUploadedVideoPreview,
    isUserUploadedObjectKey: mocks.isUserUploadedObjectKey,
  };
});

vi.mock('../src/storage/storageService.js', () => ({
  buildPublicUrl: (objectKey: string) => `https://public.invalid/${objectKey}`,
}));

import {
  backfillUploadedVideoThumbnails,
  isPermanentVideoPreviewFailure,
  parseGeneratedVideoMode,
  recoverPendingGeneratedVideoThumbnails,
} from '../src/tools/backfillUploadedVideoThumbnails.js';

const asset = {
  id: '00000000-0000-4000-8000-000000000001',
  user_id: '00000000-0000-4000-8000-000000000002',
  object_key: 'users/00000000-0000-4000-8000-000000000002/uploads/video.mp4',
  thumbnail_key: null,
  thumbnail_status: 'pending' as const,
  width: null,
  height: null,
  duration_seconds: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

const generatedAsset = {
  ...asset,
  object_key: `generated/video/${asset.user_id}/task-1/attempt-0/output.mp4`,
  generation_thumbnail_key: `generated/video/${asset.user_id}/task-1/attempt-0/thumbnail.jpg`,
  thumbnail_updated_at: null,
  width: 1920,
  height: 1080,
  duration_seconds: '12',
};

describe('历史上传视频缩略图回填', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.isUserUploadedObjectKey.mockReturnValue(true);
    mocks.scheduleObjectDeletion.mockResolvedValue(undefined);
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('每批只取 50 条，CAS 竞争失败后把确定性新对象交给删除 Outbox', async () => {
    let page = 0;
    mocks.poolQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT id, user_id, object_key')) {
        page += 1;
        expect(params[1]).toBe(50);
        return { rows: page === 1 ? [asset] : [], rowCount: page === 1 ? 1 : 0 };
      }
      return { rows: [{ pending: '0', failed: '0' }], rowCount: 1 };
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes('SELECT id, user_id, object_key')) return { rows: [asset], rowCount: 1 };
      if (sql.includes('UPDATE assets')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    mocks.createUploadedVideoPreview.mockResolvedValue({
      thumbnailKey: `users/${asset.user_id}/asset-thumbnails/${asset.id}.jpg`,
      width: 1920,
      height: 1080,
      durationSeconds: 12,
    });

    const result = await backfillUploadedVideoThumbnails();

    expect(mocks.createUploadedVideoPreview).toHaveBeenCalledWith(expect.objectContaining({
      thumbnailKey: `users/${asset.user_id}/asset-thumbnails/${asset.id}.jpg`,
    }));
    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.transactionQuery }),
      `users/${asset.user_id}/asset-thumbnails/${asset.id}.jpg`,
      [],
      expect.any(Date),
    );
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ updated: 0, skipped: 1 });
  });

  it('拿不到 advisory lock 时不执行 FFmpeg/TOS，也不删除其他 worker 的对象', async () => {
    let page = 0;
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, user_id, object_key')) {
        page += 1;
        return { rows: page === 1 ? [asset] : [], rowCount: page === 1 ? 1 : 0 };
      }
      return { rows: [{ pending: '1', failed: '0' }], rowCount: 1 };
    });
    mocks.clientQuery.mockResolvedValueOnce({ rows: [{ locked: false }], rowCount: 1 });

    const result = await backfillUploadedVideoThumbnails();

    expect(mocks.createUploadedVideoPreview).not.toHaveBeenCalled();
    expect(mocks.scheduleObjectDeletion).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 1, pendingCount: 1 });
  });

  it('日志不输出供应商原始错误、签名 URL 或对象 key', async () => {
    let page = 0;
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, user_id, object_key')) {
        page += 1;
        return { rows: page === 1 ? [asset] : [], rowCount: page === 1 ? 1 : 0 };
      }
      return { rows: [{ pending: '1', failed: '0' }], rowCount: 1 };
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes('SELECT id, user_id, object_key')) return { rows: [asset], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mocks.createUploadedVideoPreview.mockRejectedValue(Object.assign(
      new Error('https://tos.invalid/video.mp4?X-Tos-Signature=secret'),
      { code: 'https://tos.invalid/secret' },
    ));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await backfillUploadedVideoThumbnails();
    const output = JSON.stringify(errorLog.mock.calls);

    expect(output).not.toContain('tos.invalid');
    expect(output).not.toContain('secret');
    expect(output).not.toContain(asset.object_key);
    expect(output).toContain('VIDEO_PREVIEW_PROCESSING_FAILED');
    expect(result).toMatchObject({ retryableFailed: 1, pendingCount: 1 });
    errorLog.mockRestore();
  });
});

describe('历史视频缩略图错误分类', () => {
  it('损坏视频是永久失败', () => {
    const wrapped = Object.assign(new Error('上传视频缩略图生成失败'), {
      cause: new Error('moov atom not found'),
    });
    expect(isPermanentVideoPreviewFailure(wrapped)).toBe(true);
  });

  it('网络、鉴权或 TOS 错误保持可重试', () => {
    expect(isPermanentVideoPreviewFailure(new Error('TOS request timed out'))).toBe(false);
    expect(isPermanentVideoPreviewFailure(new Error('SignatureDoesNotMatch'))).toBe(false);
  });
});

describe('生成视频缩略图恢复', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.scheduleObjectDeletion.mockResolvedValue(undefined);
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.poolQuery.mockResolvedValue({ rows: [generatedAsset], rowCount: 1 });
  });

  it('从已归档成片生成 run 固定 key，并用完整资产快照 CAS 写为 ready', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes('SELECT asset.id')) return { rows: [generatedAsset], rowCount: 1 };
      if (sql.includes('SET thumbnail_key = $2')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mocks.createUploadedVideoPreview.mockResolvedValue({
      thumbnailKey: generatedAsset.generation_thumbnail_key,
      width: 1920,
      height: 1080,
      durationSeconds: 12,
    });

    const result = await recoverPendingGeneratedVideoThumbnails();

    expect(mocks.poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("asset.source = 'ai-video'"),
      [null, 10, false],
    );
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('run.output_object_key = asset.object_key');
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('thumbnail_updated_at ASC NULLS FIRST');
    expect(mocks.createUploadedVideoPreview).toHaveBeenCalledWith({
      userId: generatedAsset.user_id,
      objectKey: generatedAsset.object_key,
      existingThumbnailKey: null,
      thumbnailKey: generatedAsset.generation_thumbnail_key,
    });
    const casSql = mocks.clientQuery.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('SET thumbnail_key = $2'))!;
    expect(casSql).toContain("source = 'ai-video'");
    expect(casSql).toContain('thumbnail_updated_at IS NOT DISTINCT FROM $13::timestamptz');
    expect(mocks.scheduleObjectDeletion).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, updated: 1, skipped: 0, permanentFailed: 0, retryableFailed: 0 });
  });

  it('CAS 输家不写资产，并把已经上传的确定性对象交给删除 Outbox 复核', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes('SELECT asset.id')) return { rows: [generatedAsset], rowCount: 1 };
      if (sql.includes('SET thumbnail_key = $2')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    mocks.createUploadedVideoPreview.mockResolvedValue({
      thumbnailKey: generatedAsset.generation_thumbnail_key,
      width: 1920,
      height: 1080,
      durationSeconds: 12,
    });

    const result = await recoverPendingGeneratedVideoThumbnails();

    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.transactionQuery }),
      generatedAsset.generation_thumbnail_key,
      [],
      expect.any(Date),
    );
    expect(result).toMatchObject({ updated: 0, skipped: 1 });
  });

  it('TOS 或网络暂时失败保持 pending 并设置五分钟退避，不永久留下占位图', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes('SELECT asset.id')) return { rows: [generatedAsset], rowCount: 1 };
      if (sql.includes('SET thumbnail_updated_at = now()')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mocks.createUploadedVideoPreview.mockRejectedValue(new Error('TOS request timed out'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await recoverPendingGeneratedVideoThumbnails();

    const retrySql = mocks.clientQuery.mock.calls.map(([sql]) => String(sql))
      .find(sql => sql.includes('SET thumbnail_updated_at = now()'))!;
    expect(retrySql).toContain("thumbnail_status = 'pending'");
    expect(mocks.clientQuery.mock.calls.map(([sql]) => String(sql)).join('\n'))
      .not.toContain("thumbnail_status = 'failed'");
    expect(result).toMatchObject({ retryableFailed: 1, permanentFailed: 0 });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('TOS request timed out');
    errorLog.mockRestore();
  });

  it('明确损坏的归档视频才转 failed，且工具支持生成视频模式', async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes('SELECT asset.id')) return { rows: [generatedAsset], rowCount: 1 };
      if (sql.includes("thumbnail_status = 'failed'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mocks.createUploadedVideoPreview.mockRejectedValue(Object.assign(
      new Error('上传视频缩略图生成失败'),
      { cause: new Error('moov atom not found') },
    ));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await recoverPendingGeneratedVideoThumbnails({ force: true, limit: 100 });

    expect(mocks.poolQuery).toHaveBeenCalledWith(expect.any(String), [null, 50, true]);
    expect(result).toMatchObject({ permanentFailed: 1, retryableFailed: 0 });
    expect(parseGeneratedVideoMode(['--generated'])).toBe(true);
    errorLog.mockRestore();
  });
});
