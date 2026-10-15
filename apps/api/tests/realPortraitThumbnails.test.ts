import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const sharp = createRequire(import.meta.url)('sharp');
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), read: vi.fn(), upload: vi.fn(), deletion: vi.fn() }));
vi.mock('../src/db/pool.js', () => ({ pool: { query: mocks.query }, withTransaction: mocks.transaction }));
vi.mock('../src/storage/storageService.js', () => ({ openStoredObjectStream: mocks.read, uploadObjectBuffer: mocks.upload }));
vi.mock('../src/domain/assetDeletionService.js', () => ({ scheduleObjectDeletion: mocks.deletion }));
import { createPortraitThumbnail, ensureRealPortraitThumbnail, readRealPortraitThumbnail, scheduleInvalidRealPortraitThumbnailDeletion } from '../src/domain/realPortraitThumbnails.js';

describe('真人缩略图生成、读取与清理', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(callback => callback({ query: mocks.query }));
  });

  it.each([[900, 1600, 90, 160], [1600, 900, 160, 90], [600, 600, 160, 160]])('缩放 %s×%s 不变形且移除原始元数据', async (width, height, expectedWidth, expectedHeight) => {
    const input = await sharp({ create: { width, height, channels: 3, background: '#d4c3b2' } }).withMetadata().jpeg().toBuffer();
    const output = await createPortraitThumbnail(input);
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: expectedWidth, height: expectedHeight });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it('生成就绪后重复调用不会重新写入对象；旧授权无预留键也不读取原图', async () => {
    const input = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#777' } }).png().toBuffer();
    let ready = false;
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT pa.thumbnail_object_key')) return { rows: ready ? [] : [{ thumbnail_object_key: 'private/asset.webp' }] };
      if (sql.startsWith('UPDATE')) ready = true;
      return { rows: [] };
    });
    mocks.read.mockResolvedValue(Readable.from(input));
    await ensureRealPortraitThumbnail('user', 'asset', 'original');
    await ensureRealPortraitThumbnail('user', 'asset', 'original');
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0][0]).toMatchObject({ objectKey: 'private/asset.webp', contentType: 'image/webp' });
  });

  it('存储失败不标记就绪，保留预留键供重试和清理', async () => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT pa.thumbnail_object_key') ? [{ thumbnail_object_key: 'reserved' }] : [] }));
    mocks.read.mockResolvedValue(Readable.from(await sharp({ create: { width: 300, height: 300, channels: 3, background: '#777' } }).png().toBuffer()));
    mocks.upload.mockRejectedValue(new Error('存储失败'));
    await expect(ensureRealPortraitThumbnail('user', 'asset', 'original')).rejects.toThrow('存储失败');
    expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('没有可读记录时返回404，且不接触私有存储', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(readRealPortraitThumbnail('other-user', 'actor', 'asset')).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0][1]).toEqual(['actor', 'other-user', 'asset']);
  });

  it('授权通过后返回存储流，不签发可以绕过撤回检查的对象URL', async () => {
    const stream = Readable.from('webp');
    mocks.query.mockResolvedValue({ rows: [{ thumbnail_object_key: 'private/asset.webp' }] });
    mocks.read.mockResolvedValue(stream);
    expect(await readRealPortraitThumbnail('user', 'actor', 'asset')).toBe(stream);
  });

  it('失效清理先写删除队列，再清空可用性；重放不重复入队', async () => {
    let cleared = false;
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT pa.id')) return { rows: cleared ? [] : [{ id: 'asset', thumbnail_object_key: 'private/asset.webp' }] };
      if (sql.startsWith('UPDATE')) cleared = true;
      return { rows: [] };
    });
    expect(await scheduleInvalidRealPortraitThumbnailDeletion()).toBe(1);
    expect(await scheduleInvalidRealPortraitThumbnailDeletion()).toBe(0);
    expect(mocks.deletion).toHaveBeenCalledTimes(1);
    expect(mocks.deletion).toHaveBeenCalledWith(expect.anything(), 'private/asset.webp');
  });
});
