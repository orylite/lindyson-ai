import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/pool.js';
import {
  compileSeedreamPrompt,
  getSeedreamOutputSize,
  sanitizeSeedreamImageConfig,
} from '../src/domain/seedreamModels.js';

const assetId = '00000000-0000-4000-8000-000000000101';

describe('seedreamModels', () => {
  it('按固定比例映射 1K/2K 像素，并允许零参考图文生图', async () => {
    expect(getSeedreamOutputSize('1K', '16:9')).toBe('1424x800');
    expect(getSeedreamOutputSize('2K', '9:16')).toBe('1584x2816');

    await expect(sanitizeSeedreamImageConfig({
      client: makeClient([]),
      userId: 'user-1',
      model: 'Seedream 5.0 Pro',
      prompt: '一杯咖啡',
      config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
      references: [],
      annotations: [],
    })).resolves.toEqual({
      resolution: '1K',
      aspectRatio: '1:1',
      optimizePromptMode: 'standard',
      outputSize: '1024x1024',
      referenceAssets: [],
      annotations: [],
    });
  });

  it('只按当前用户资产 ID 固化规范参考图，并在 provider 边界编译坐标标签', async () => {
    const config = await sanitizeSeedreamImageConfig({
      client: makeClient([validAsset()]),
      userId: 'user-1',
      model: 'Seedream 5.0 Pro',
      prompt: '把 @标记1 换成皇冠',
      config: { resolution: '2K', aspectRatio: '3:4', optimizePromptMode: 'fast' },
      references: [{ assetId, role: 'reference_image' }],
      annotations: [{ token: '@标记1', assetId, type: 'bbox', x1: 10, y1: 20, x2: 800, y2: 900 }],
    });

    expect(config.referenceAssets).toEqual([expect.objectContaining({
      id: assetId,
      type: 'image',
      role: 'reference_image',
      objectKey: 'users/user-1/ref.png',
      width: 2048,
      height: 2048,
    })]);
    expect(compileSeedreamPrompt('把 @标记1 换成皇冠', config)).toBe(
      '把 图 1 <bbox>10 20 800 900</bbox> 换成皇冠',
    );
  });

  it('允许 @图片N 与 @标记N 共存，并只在 provider 边界编译图片序号和坐标', async () => {
    const config = await sanitizeSeedreamImageConfig({
      client: makeClient([validAsset()]),
      userId: 'user-1',
      model: 'Seedream 5.0 Pro',
      prompt: '保持 @图片1中的主体，把 @标记1 换成皇冠',
      config: { resolution: '2K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
      references: [{ assetId, role: 'reference_image' }],
      annotations: [{ token: '@标记1', assetId, type: 'point', x: 520, y: 460 }],
    });

    expect(compileSeedreamPrompt('保持 @图片1中的主体，把 @标记1 换成皇冠', config)).toBe(
      '保持 图 1中的主体，把 图 1 <point>520 460</point> 换成皇冠',
    );
  });

  it.each([
    { label: '缺少编号', prompt: '参考 @图片 生成' },
    { label: '编号为零', prompt: '参考 @图片0 生成' },
    { label: '非法编号', prompt: '参考 @图片x 生成' },
    { label: '编号含前导零', prompt: '参考 @图片01 生成' },
    { label: '编号后连接字母', prompt: '参考 @图片1abc 生成' },
    { label: '编号为小数', prompt: '参考 @图片1.5 生成' },
    { label: '编号为范围', prompt: '参考 @图片1-2 生成' },
    { label: '编号为分数', prompt: '参考 @图片1/2 生成' },
  ])('清洗和 provider 编译边界都拒绝$label的图片引用', async ({ prompt }) => {
    await expect(sanitizeSeedreamImageConfig({
      client: makeClient([validAsset()]),
      userId: 'user-1',
      model: 'Seedream 5.0 Pro',
      prompt,
      config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
      references: [{ assetId, role: 'reference_image' }],
      annotations: [],
    })).rejects.toThrow('图片引用格式无效');

    expect(() => compileSeedreamPrompt(prompt, {
      referenceAssets: [{ id: assetId }],
      annotations: [],
    })).toThrow('图片引用格式无效');
  });

  it('清洗和 provider 编译边界都拒绝越界的 @图片N', async () => {
    await expect(sanitizeSeedreamImageConfig({
      client: makeClient([validAsset()]),
      userId: 'user-1',
      model: 'Seedream 5.0 Pro',
      prompt: '参考 @图片2 生成',
      config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
      references: [{ assetId, role: 'reference_image' }],
      annotations: [],
    })).rejects.toThrow('@图片2 没有对应参考图片');

    expect(() => compileSeedreamPrompt('参考 @图片2 生成', {
      referenceAssets: [{ id: assetId }],
      annotations: [],
    })).toThrow('@图片2 没有对应参考图片');
  });

  it('拒绝原始 XML、未声明/重复 token、非法框选和非参考资产标注', async () => {
    const base = {
      client: makeClient([validAsset()]),
      userId: 'user-1',
      model: 'Seedream 5.0 Pro',
      config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
      references: [{ assetId, role: 'reference_image' as const }],
    };
    await expect(sanitizeSeedreamImageConfig({
      ...base,
      prompt: '把 <point>1 2</point> 换掉',
    })).rejects.toThrow('不能直接包含 point 或 bbox XML');
    await expect(sanitizeSeedreamImageConfig({
      ...base,
      prompt: '编辑 @标记1 和 @标记1',
      annotations: [{ token: '@标记1', assetId, type: 'point', x: 1, y: 2 }],
    })).rejects.toThrow('必须在提示词中恰好出现一次');
    await expect(sanitizeSeedreamImageConfig({
      ...base,
      prompt: '编辑 @标记2',
      annotations: [],
    })).rejects.toThrow('没有声明结构化标注');
    await expect(sanitizeSeedreamImageConfig({
      ...base,
      prompt: '编辑 @标记1',
      annotations: [{ token: '@标记1', assetId, type: 'bbox', x1: 10, y1: 10, x2: 10, y2: 20 }],
    })).rejects.toThrow('x1 < x2');
  });

  it('参考图格式与模型限制 fail closed，明确拒绝 AVIF', async () => {
    await expect(sanitizeSeedreamImageConfig({
      client: makeClient([validAsset({ name: 'ref.avif', object_key: 'users/user-1/ref.avif' })]),
      userId: 'user-1',
      model: 'Seedream 5.0 Pro',
      prompt: '编辑图片',
      config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
      references: [{ assetId, role: 'reference_image' }],
    })).rejects.toThrow('只支持 JPEG、PNG、WebP、BMP、TIFF、GIF、HEIC 或 HEIF');
  });

  it.each([
    { label: '文件大小缺失', size_bytes: null },
    { label: '文件大小为零', size_bytes: 0 },
    { label: '文件大小为负数', size_bytes: -1 },
    { label: '文件大小不是整数', size_bytes: 1024.5 },
  ])('为 $label 返回独立的参考图元数据错误', async ({ size_bytes }) => {
    await expect(sanitizeSingleReference({ size_bytes })).rejects.toMatchObject({
      statusCode: 400,
      code: 'REFERENCE_IMAGE_METADATA_INCOMPLETE',
      message: '参考图片缺少可校验的文件大小',
    });
  });

  it.each([
    { label: '宽高都缺失', width: null, height: null },
    { label: '宽度缺失', width: null, height: 1024 },
    { label: '高度缺失', width: 1024, height: null },
    { label: '宽度不是整数', width: 1024.5, height: 1024 },
    { label: '高度不是正数', width: 1024, height: 0 },
  ])('为 $label 返回独立的参考图元数据错误', async ({ width, height }) => {
    await expect(sanitizeSingleReference({ width, height })).rejects.toMatchObject({
      statusCode: 400,
      code: 'REFERENCE_IMAGE_METADATA_INCOMPLETE',
      message: '参考图片缺少完整且有效的宽高元数据',
    });
  });

  it.each([
    { width: 14, height: 15 },
    { width: 15, height: 14 },
  ])('拒绝宽高不大于 14 像素的真实图片：$width x $height', async ({ width, height }) => {
    await expect(sanitizeSingleReference({ width, height })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_SEEDREAM_REQUEST',
      message: '参考图片宽度和高度必须均大于 14 像素',
    });
  });

  it('接受 15 像素边界及 PostgreSQL 返回的整数字符串', async () => {
    await expect(sanitizeSingleReference({ width: 15, height: 15 })).resolves.toEqual(
      expect.objectContaining({
        referenceAssets: [expect.objectContaining({ width: 15, height: 15 })],
      }),
    );

    await expect(sanitizeSingleReference({
      width: '2048',
      height: '1024',
      size_bytes: '4096',
    })).resolves.toEqual(expect.objectContaining({
      referenceAssets: [expect.objectContaining({ width: 2048, height: 1024, sizeBytes: 4096 })],
    }));
  });

  it('允许 3600 万总像素边界并拒绝超出边界', async () => {
    await expect(sanitizeSingleReference({ width: 6000, height: 6000 })).resolves.toBeDefined();
    await expect(sanitizeSingleReference({ width: 6001, height: 6000 }))
      .rejects.toThrow('单张参考图片总像素不能超过 3600 万');
  });

  it.each([
    { width: 100, height: 1600 },
    { width: 1600, height: 100 },
  ])('允许 1:16 到 16:1 的闭区间边界：$width x $height', async ({ width, height }) => {
    await expect(sanitizeSingleReference({ width, height })).resolves.toBeDefined();
  });

  it.each([
    { width: 99, height: 1600 },
    { width: 1600, height: 99 },
  ])('拒绝超出 1:16 到 16:1 的宽高比：$width x $height', async ({ width, height }) => {
    await expect(sanitizeSingleReference({ width, height }))
      .rejects.toThrow('参考图片宽高比必须在 1:16 到 16:1 之间');
  });
});

function sanitizeSingleReference(overrides: Record<string, unknown> = {}) {
  return sanitizeSeedreamImageConfig({
    client: makeClient([validAsset(overrides)]),
    userId: 'user-1',
    model: 'Seedream 5.0 Pro',
    prompt: '编辑图片',
    config: { resolution: '1K', aspectRatio: '1:1', optimizePromptMode: 'standard' },
    references: [{ assetId, role: 'reference_image' }],
    annotations: [],
  });
}

function makeClient(rows: Array<Record<string, unknown>>) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as DbClient;
}

function validAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: assetId,
    user_id: 'user-1',
    name: 'ref.png',
    object_key: 'users/user-1/ref.png',
    thumbnail_key: null,
    thumbnail_status: null,
    type: 'image',
    duration_seconds: null,
    size_bytes: 1024,
    width: 2048,
    height: 2048,
    ...overrides,
  };
}
