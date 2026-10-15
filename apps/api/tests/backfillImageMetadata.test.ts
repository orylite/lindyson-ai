import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  getStoredObjectSize: vi.fn(),
  resolveObjectProcessingInput: vi.fn(),
  probeMedia: vi.fn(),
  validateMediaDecoding: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.connect,
    end: vi.fn(),
  },
}));

vi.mock('../src/storage/storageService.js', () => ({
  getStoredObjectSize: mocks.getStoredObjectSize,
  resolveObjectProcessingInput: mocks.resolveObjectProcessingInput,
}));

vi.mock('../src/storage/mediaProcessor.js', () => ({
  probeMedia: mocks.probeMedia,
  validateMediaDecoding: mocks.validateMediaDecoding,
}));

import {
  backfillImageMetadata,
  parseBackfillImageMetadataArgs,
  shouldFailImageMetadataBackfill,
} from '../src/tools/backfillImageMetadata.js';

const assetId = '00000000-0000-4000-8000-000000000001';
const asset: {
  id: string;
  user_id: string;
  name: string;
  object_key: string;
  size_bytes: number | string | null;
  width: number | string | null;
  height: number | string | null;
  created_at: Date | string;
} = {
  id: assetId,
  user_id: '00000000-0000-4000-8000-000000000002',
  name: '历史图片.png',
  object_key: 'users/00000000-0000-4000-8000-000000000002/uploads/history.png',
  size_bytes: '1024',
  width: null,
  height: null,
  created_at: new Date('2026-07-01T00:00:00.000Z'),
};

const detectedImage = {
  width: 1920,
  height: 1080,
  durationSeconds: null,
  hasVideo: true,
  hasAudio: false,
  formatName: 'png_pipe',
  frameCount: 1,
  videoCodec: 'png',
  majorBrand: null,
};

describe('历史图片原图元数据回填', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.getStoredObjectSize.mockResolvedValue(2048);
    mocks.resolveObjectProcessingInput.mockResolvedValue('https://tos.invalid/original?signature=secret');
    mocks.probeMedia.mockResolvedValue(detectedImage);
    mocks.validateMediaDecoding.mockResolvedValue(undefined);
  });

  it('按 50 条游标分页、逐资产加锁，并用原图探测结果执行完整快照 CAS', async () => {
    installSinglePage([asset], 0);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([asset]);
      if (sql.includes('UPDATE assets')) return queryResult([], 1);
      return queryResult([]);
    });

    const result = await backfillImageMetadata();

    expect(mocks.poolQuery.mock.calls[0]?.[1]).toEqual([null, 50, null, null]);
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).not.toContain('thumbnail_status');
    expect(mocks.getStoredObjectSize).toHaveBeenCalledWith(asset.object_key);
    expect(mocks.resolveObjectProcessingInput).toHaveBeenCalledWith(asset.object_key);
    expect(mocks.probeMedia).toHaveBeenCalledWith('https://tos.invalid/original?signature=secret');
    expect(mocks.validateMediaDecoding).toHaveBeenCalledWith(
      'https://tos.invalid/original?signature=secret',
      'image',
    );

    const updateCall = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE assets'));
    expect(String(updateCall?.[0])).toContain('size_bytes IS NOT DISTINCT FROM $7::bigint');
    expect(String(updateCall?.[0])).toContain('width IS NOT DISTINCT FROM $8::integer');
    expect(String(updateCall?.[0])).toContain("deletion_status = 'active'");
    expect(updateCall?.[1]).toEqual([
      asset.id, 2048, 1920, 1080, asset.user_id, asset.object_key,
      asset.size_bytes, asset.width, asset.height,
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      [`asset-image-metadata:${asset.id}`],
    );
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(result).toEqual({
      dryRun: false,
      assetId: null,
      scanned: 1,
      updated: 1,
      wouldUpdate: 0,
      skipped: 0,
      failed: 0,
      remainingCount: 0,
    });
    expect(shouldFailImageMetadataBackfill(result)).toBe(false);
  });

  it('dry-run 与单资产过滤可组合，仍探测和完整解码但绝不写库', async () => {
    installSinglePage([asset], 1);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([asset]);
      return queryResult([]);
    });

    const result = await backfillImageMetadata({ dryRun: true, assetId });

    expect(mocks.poolQuery.mock.calls[0]?.[1]).toEqual([assetId, 50, null, null]);
    expect(mocks.validateMediaDecoding).toHaveBeenCalledOnce();
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE assets'))).toBe(false);
    expect(result).toMatchObject({
      dryRun: true,
      assetId,
      scanned: 1,
      updated: 0,
      wouldUpdate: 1,
      skipped: 0,
      failed: 0,
      remainingCount: 1,
    });
    expect(shouldFailImageMetadataBackfill(result)).toBe(false);
  });

  it('游标保留 PostgreSQL 微秒精度，dry-run 或失败行不会被重复扫描', async () => {
    const exactCreatedAt = '2026-07-01 00:00:00.123456+00';
    const preciseAsset = { ...asset, created_at: exactCreatedAt };
    let page = 0;
    mocks.poolQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT id, user_id, name')) {
        page += 1;
        if (page === 1) return queryResult([preciseAsset]);
        expect(params).toEqual([null, 50, exactCreatedAt, asset.id]);
        return queryResult([]);
      }
      if (sql.includes('count(*)::bigint')) return queryResult([{ count: '1' }]);
      return queryResult([]);
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([preciseAsset]);
      return queryResult([]);
    });

    const result = await backfillImageMetadata({ dryRun: true });

    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain('created_at::text AS created_at');
    expect(page).toBe(2);
    expect(result).toMatchObject({ scanned: 1, wouldUpdate: 1, remainingCount: 1 });
  });

  it('同批原图探测并发不会超过 2', async () => {
    const assets = [0, 1, 2, 3].map(index => ({
      ...asset,
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    }));
    installSinglePage(assets, 0);
    mocks.clientQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) {
        return queryResult([assets.find(item => item.id === params[0])!]);
      }
      if (sql.includes('UPDATE assets')) return queryResult([], 1);
      return queryResult([]);
    });
    let active = 0;
    let maxActive = 0;
    mocks.probeMedia.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return detectedImage;
    });

    const result = await backfillImageMetadata();

    expect(maxActive).toBe(2);
    expect(result).toMatchObject({ scanned: 4, updated: 4, failed: 0 });
  });

  it('拿不到 advisory lock 时不读取原图，且未收口的正式回填返回失败门禁', async () => {
    installSinglePage([asset], 1);
    mocks.clientQuery.mockResolvedValueOnce(queryResult([{ locked: false }]));

    const result = await backfillImageMetadata();

    expect(mocks.getStoredObjectSize).not.toHaveBeenCalled();
    expect(mocks.probeMedia).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 1, remainingCount: 1 });
    expect(shouldFailImageMetadataBackfill(result)).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('资产在加锁后已删除时安全跳过，不探测原图也不执行更新', async () => {
    installSinglePage([asset], 0);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([]);
      return queryResult([]);
    });

    const result = await backfillImageMetadata();

    expect(mocks.getStoredObjectSize).not.toHaveBeenCalled();
    expect(mocks.probeMedia).not.toHaveBeenCalled();
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE assets'))).toBe(false);
    expect(result).toMatchObject({ skipped: 1, updated: 0, failed: 0, remainingCount: 0 });
  });

  it('完整快照 CAS 竞争失败时不误报已更新，并由剩余计数阻断正式回填', async () => {
    installSinglePage([asset], 1);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([asset]);
      if (sql.includes('UPDATE assets')) return queryResult([], 0);
      return queryResult([]);
    });

    const result = await backfillImageMetadata();

    expect(result).toMatchObject({ skipped: 1, updated: 0, failed: 0, remainingCount: 1 });
    expect(shouldFailImageMetadataBackfill(result)).toBe(true);
  });

  it('单边宽高缺失时从原图补齐两边，并以单边旧值参与 CAS', async () => {
    const oneSidedAsset = { ...asset, height: '1080' };
    installSinglePage([oneSidedAsset], 0);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([oneSidedAsset]);
      if (sql.includes('UPDATE assets')) return queryResult([], 1);
      return queryResult([]);
    });

    const result = await backfillImageMetadata();

    const updateCall = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE assets'));
    expect(updateCall?.[1]).toEqual([
      asset.id, 2048, 1920, 1080, asset.user_id, asset.object_key,
      asset.size_bytes, null, '1080',
    ]);
    expect(result).toMatchObject({ updated: 1, failed: 0, remainingCount: 0 });
  });

  it.each([
    ['临时 TOS HEAD 故障', 'size', 'TOS_TEMPORARY_UNAVAILABLE'],
    ['临时 TOS 签名故障', 'input', 'TOS_SIGNING_TEMPORARY_FAILURE'],
    ['损坏原图完整解码失败', 'decode', 'IMAGE_DECODE_FAILED'],
    ['探测到非图片媒体', 'media', 'IMAGE_METADATA_MEDIA_INVALID'],
  ] as const)('%s 时不猜测尺寸、不写库并保持非零门禁', async (_label, stage, code) => {
    installSinglePage([asset], 1);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([asset]);
      return queryResult([]);
    });
    if (stage === 'size') mocks.getStoredObjectSize.mockRejectedValue(Object.assign(new Error(code), { code }));
    if (stage === 'input') mocks.resolveObjectProcessingInput.mockRejectedValue(Object.assign(new Error(code), { code }));
    if (stage === 'decode') mocks.validateMediaDecoding.mockRejectedValue(Object.assign(new Error(code), { code }));
    if (stage === 'media') mocks.probeMedia.mockResolvedValue({ ...detectedImage, hasAudio: true });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await backfillImageMetadata();

    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE assets'))).toBe(false);
    expect(result).toMatchObject({ failed: 1, remainingCount: 1 });
    expect(shouldFailImageMetadataBackfill(result)).toBe(true);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(code);
    errorLog.mockRestore();
  });

  it('advisory lock 解锁失败时销毁连接，避免持锁连接回到连接池', async () => {
    installSinglePage([asset], 0);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([asset]);
      if (sql.includes('UPDATE assets')) return queryResult([], 1);
      if (sql.includes('pg_advisory_unlock')) throw new Error('secret connection failure');
      return queryResult([]);
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await backfillImageMetadata();

    expect(result).toMatchObject({ updated: 1, failed: 0, remainingCount: 0 });
    expect(mocks.release).toHaveBeenCalledWith(true);
    expect(JSON.stringify(errorLog.mock.calls)).toContain('IMAGE_METADATA_LOCK_RELEASE_FAILED');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret connection failure');
    errorLog.mockRestore();
  });

  it('探测失败只记录资产 ID 和安全错误码，不泄露对象 key、签名 URL或原始错误', async () => {
    installSinglePage([asset], 1);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) return queryResult([asset]);
      return queryResult([]);
    });
    mocks.probeMedia.mockRejectedValue(Object.assign(
      new Error(`读取失败：${asset.object_key} https://tos.invalid/original?signature=secret`),
      { code: 'https://tos.invalid/secret' },
    ));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await backfillImageMetadata();
    const output = JSON.stringify(errorLog.mock.calls);

    expect(output).toContain(asset.id);
    expect(output).toContain('IMAGE_METADATA_PROCESSING_FAILED');
    expect(output).not.toContain(asset.object_key);
    expect(output).not.toContain('tos.invalid');
    expect(output).not.toContain('secret');
    expect(result).toMatchObject({ failed: 1, remainingCount: 1 });
    expect(shouldFailImageMetadataBackfill(result)).toBe(true);
    errorLog.mockRestore();
  });

  it('已被其他执行者修复的资产可安全重放并跳过，不再读取原图或写库', async () => {
    installSinglePage([asset], 0);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return queryResult([{ locked: true }]);
      if (sql.includes('SELECT id, user_id, name')) {
        return queryResult([{ ...asset, width: 1920, height: 1080 }]);
      }
      return queryResult([]);
    });

    const result = await backfillImageMetadata();

    expect(mocks.getStoredObjectSize).not.toHaveBeenCalled();
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE assets'))).toBe(false);
    expect(result).toMatchObject({ skipped: 1, failed: 0, remainingCount: 0 });
    expect(shouldFailImageMetadataBackfill(result)).toBe(false);
  });
});

describe('图片元数据回填 CLI 参数', () => {
  it('支持 --dry-run 与 --asset-id 任意顺序', () => {
    expect(parseBackfillImageMetadataArgs(['--asset-id', assetId, '--dry-run'])).toEqual({
      dryRun: true,
      assetId,
    });
  });

  it.each([
    ['--asset-id'],
    ['--asset-id', 'not-a-uuid'],
    ['--asset-id', assetId, '--asset-id', assetId],
    ['--unknown'],
  ])('拒绝不完整、非法、重复或未知参数：%j', (...args) => {
    expect(() => parseBackfillImageMetadataArgs(args)).toThrow();
  });
});

function installSinglePage(rows: typeof asset[], remainingCount: number) {
  let page = 0;
  mocks.poolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT id, user_id, name')) {
      page += 1;
      return queryResult(page === 1 ? rows : []);
    }
    if (sql.includes('count(*)::bigint')) return queryResult([{ count: String(remainingCount) }]);
    return queryResult([]);
  });
}

function queryResult<T>(rows: T[], rowCount = rows.length) {
  return { rows, rowCount };
}
