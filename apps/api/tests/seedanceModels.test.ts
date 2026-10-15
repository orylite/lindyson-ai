import { describe, expect, it, vi } from 'vitest';
import {
  getSeedanceModelCapability,
  sanitizeSeedanceVideoConfig,
  SEEDANCE_COST_MODEL_LABELS,
  SEEDANCE_MODEL_CAPABILITIES,
  SEEDANCE_MODEL_LABELS,
} from '../src/domain/seedanceModels.js';
import type { DbClient } from '../src/db/pool.js';

describe('seedanceModels', () => {
  it('正式模型与成本模型共用同一组无重复 label，成本看盘固定 2.5 优先', () => {
    expect(SEEDANCE_MODEL_LABELS).toContain('Seedance 2.5');
    expect(SEEDANCE_COST_MODEL_LABELS).toEqual([
      'Seedance 2.5',
      'Seedance 2.0',
      'Seedance 2.0 Fast',
      'Seedance 2.0 Mini',
    ]);
    expect(new Set(SEEDANCE_COST_MODEL_LABELS)).toEqual(new Set(SEEDANCE_MODEL_LABELS));
    expect(new Set(SEEDANCE_COST_MODEL_LABELS).size).toBe(SEEDANCE_COST_MODEL_LABELS.length);
    expect(SEEDANCE_MODEL_CAPABILITIES).toHaveLength(SEEDANCE_MODEL_LABELS.length);
    expect(getSeedanceModelCapability('Seedance 2.5')).toEqual(expect.objectContaining({
      id: 'seedance-2.5',
      recommended: true,
      resolutions: ['480p', '720p'],
      durationSeconds: [5, 10, 15, 20, 25, 30],
      modes: ['general', 'first-last'],
      aspectRatios: { general: ['9:16', '16:9'], firstLast: ['adaptive'] },
      references: expect.objectContaining({
        maxTotal: 50,
        maxImages: 30,
        maxVideos: 10,
        maxAudios: 10,
        maxVideoDurationSeconds: 30,
        maxAudioDurationSeconds: 30,
        allowAudioOnly: true,
      }),
      supportsPromptWizard: false,
      supportsRealPortrait: false,
      outputFormat: 'mp4',
      generateAudio: true,
    }));
  });

  it('拒绝未显式接入清洗边界的视频模型', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]),
      userId: 'user-1',
      model: 'Unknown Video Model',
      config: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5 },
    })).rejects.toMatchObject({
      statusCode: 400,
      message: '当前视频模型暂不开放',
    });
  });

  it('后端按资产 ID 解析 Seedance 引用并只持久化规范 referenceAssets', async () => {
    const client = makeClient([
      {
        id: '00000000-0000-4000-8000-000000000101',
        name: '数据库参考图',
        object_key: 'users/user-1/ref.png',
        thumbnail_key: 'users/user-1/ref-thumb.jpg',
        type: 'image',
        duration_seconds: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        name: '数据库参考视频',
        object_key: 'users/user-1/ref.mp4',
        thumbnail_key: 'users/user-1/video-thumb.jpg',
        type: 'video',
        duration_seconds: 8,
      },
    ]);

    const config = await sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {
        mode: 'general',
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 15,
        generateAudio: false,
      },
      references: [
        { assetId: '00000000-0000-4000-8000-000000000101', role: 'reference_image' },
        { assetId: '00000000-0000-4000-8000-000000000102', role: 'reference_video' },
      ],
    });

    expect(config).toEqual(expect.objectContaining({
      mode: 'general',
      aspectRatio: '16:9',
      resolution: '720p',
      durationSeconds: 15,
      generateAudio: true,
    }));
    expect(config.referenceAssets).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000101',
        name: '数据库参考图',
        thumbnail: '',
        objectKey: 'users/user-1/ref.png',
        thumbnailKey: 'users/user-1/ref-thumb.jpg',
        type: 'image',
        role: 'reference_image',
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        name: '数据库参考视频',
        thumbnail: '',
        objectKey: 'users/user-1/ref.mp4',
        thumbnailKey: 'users/user-1/video-thumb.jpg',
        type: 'video',
        role: 'reference_video',
        durationSeconds: 8,
      },
    ]);
    expect(config).not.toHaveProperty('referenceImages');
  });

  it('Fast 和 Mini 模型拒绝 1080p，普通版允许 1080p', async () => {
    const client = makeClient([]);

    await expect(sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0 Fast',
      config: { resolution: '1080p' },
    })).rejects.toThrow('Seedance 2.0 Fast 当前不支持 1080p 分辨率');

    await expect(sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0 Mini',
      config: { resolution: '1080p' },
    })).rejects.toThrow('Seedance 2.0 Mini 当前不支持 1080p 分辨率');

    await expect(sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: { resolution: '1080p' },
    })).resolves.toEqual(expect.objectContaining({ resolution: '1080p' }));
  });

  it('拒绝超出 AI Studio 当前产品面的 Seedance 参数', async () => {
    const client = makeClient([]);

    await expect(sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: { aspectRatio: '1:1' },
    })).rejects.toThrow('当前视频比例暂不开放');

    await expect(sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: { durationSeconds: 30 },
    })).rejects.toThrow('当前视频时长暂不开放');
  });

  it('拒绝超过 9 张参考图、超过 3 个参考视频和参考视频总时长超过 15s', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient(Array.from({ length: 10 }, (_, index) => ({
        object_key: `image-${index}.png`, type: 'image', duration_seconds: null,
      }))),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: Array.from({ length: 10 }, (_, index) => referenceInput(index + 1, 'reference_image')),
    })).rejects.toThrow('Seedance 2.0 最多支持 9 张参考图片');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'video-1', type: 'video', duration_seconds: 2 },
        { object_key: 'video-2', type: 'video', duration_seconds: 2 },
        { object_key: 'video-3', type: 'video', duration_seconds: 2 },
        { object_key: 'video-4', type: 'video', duration_seconds: 2 },
      ]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: Array.from({ length: 4 }, (_, index) => referenceInput(index + 1, 'reference_video')),
    })).rejects.toThrow('Seedance 2.0 最多支持 3 个参考视频');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'video-1', type: 'video', duration_seconds: 8 },
        { object_key: 'video-2', type: 'video', duration_seconds: 8 },
      ]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_video'), referenceInput(2, 'reference_video')],
    })).rejects.toThrow('参考视频总时长不能超过 15s');
  });

  it('2.0 在去重前仍按原始请求数组执行最多 15 项限制', async () => {
    const duplicate = referenceInput(1, 'reference_image');
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([{ object_key: 'image.png', type: 'image', duration_seconds: null }]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: Array.from({ length: 16 }, () => duplicate),
    })).rejects.toThrow('Seedance 2.0 最多支持 15 个参考素材');
  });

  it('参考视频必须来自当前用户数字资产并带有可校验时长', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_video')],
    })).rejects.toThrow('参考素材不存在或不属于当前用户');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([{ object_key: 'video-1', type: 'video', duration_seconds: null }]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_video')],
    })).rejects.toThrow('参考视频缺少可校验的时长信息');
  });

  it('参考图片也必须绑定当前用户数字资产', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_image')],
    })).rejects.toThrow('参考素材不存在或不属于当前用户');
  });

  it('视频和音频允许 15.1s 探测容差并保持 15s 错误文案', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'image.png', type: 'image', duration_seconds: null, size_bytes: 1000 },
        { object_key: 'video.mp4', type: 'video', duration_seconds: 15.041667, size_bytes: 1000 },
        { object_key: 'audio.mp3', type: 'audio', duration_seconds: 15.1, size_bytes: 1024 * 1024 },
      ]),
      userId: 'user-1', model: 'Seedance 2.0',
      config: {},
      references: [
        referenceInput(1, 'reference_image'),
        referenceInput(2, 'reference_video'),
        referenceInput(3, 'reference_audio'),
      ],
    })).resolves.toEqual(expect.objectContaining({
      referenceAssets: expect.arrayContaining([
        expect.objectContaining({ type: 'video', durationSeconds: 15.041667 }),
        expect.objectContaining({ type: 'audio', durationSeconds: 15.1 }),
      ]),
    }));

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([{ object_key: 'video.mp4', type: 'video', duration_seconds: 15.100001, size_bytes: 1000 }]),
      userId: 'user-1', model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_video')],
    })).rejects.toThrow('单个参考视频时长必须在 2s 到 15s 之间');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'image.png', type: 'image', duration_seconds: null, size_bytes: 1000 },
        { object_key: 'audio.mp3', type: 'audio', duration_seconds: 15.100001, size_bytes: 1024 * 1024 },
      ]),
      userId: 'user-1', model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_image'), referenceInput(2, 'reference_audio')],
    })).rejects.toThrow('单个参考音频时长必须在 2s 到 15s 之间');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'video-1.mp4', type: 'video', duration_seconds: 7.550001, size_bytes: 1000 },
        { object_key: 'video-2.mp4', type: 'video', duration_seconds: 7.55, size_bytes: 1000 },
      ]),
      userId: 'user-1', model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_video'), referenceInput(2, 'reference_video')],
    })).rejects.toThrow('参考视频总时长不能超过 15s');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'image.png', type: 'image', duration_seconds: null, size_bytes: 1000 },
        { object_key: 'audio-1.mp3', type: 'audio', duration_seconds: 7.550001, size_bytes: 1000 },
        { object_key: 'audio-2.mp3', type: 'audio', duration_seconds: 7.55, size_bytes: 1000 },
      ]),
      userId: 'user-1', model: 'Seedance 2.0',
      config: {},
      references: [
        referenceInput(1, 'reference_image'),
        referenceInput(2, 'reference_audio'),
        referenceInput(3, 'reference_audio'),
      ],
    })).rejects.toThrow('参考音频总时长不能超过 15s');
  });

  it('清洗图片、视频和音频混合参考并补齐音频 role', async () => {
    const config = await sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'ref.png', type: 'image', duration_seconds: null, size_bytes: 1000 },
        { object_key: 'ref.mp4', type: 'video', duration_seconds: 6, size_bytes: 1000 },
        { object_key: 'ref.mp3', type: 'audio', duration_seconds: 9, size_bytes: 1024 * 1024 },
      ]),
      userId: 'user-1',
      model: 'Seedance 2.0 Fast',
      config: {},
      references: [
        referenceInput(1, 'reference_image'),
        referenceInput(2, 'reference_video'),
        referenceInput(3, 'reference_audio'),
      ],
    });

    expect(config.referenceAssets).toEqual([
      expect.objectContaining({ type: 'image', role: 'reference_image' }),
      expect.objectContaining({ type: 'video', role: 'reference_video', durationSeconds: 6 }),
      expect.objectContaining({ type: 'audio', role: 'reference_audio', durationSeconds: 9, sizeBytes: 1024 * 1024 }),
    ]);
  });

  it('拒绝超出音频数量、总时长、大小和组合限制的配置', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient(Array.from({ length: 4 }, (_, index) => ({
        object_key: `audio-${index}.mp3`, type: 'audio', duration_seconds: 2, size_bytes: 1000,
      }))),
      userId: 'user-1', model: 'Seedance 2.0',
      config: {},
      references: Array.from({ length: 4 }, (_, index) => referenceInput(index + 1, 'reference_audio')),
    })).rejects.toThrow('最多支持 3 个参考音频');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'image.png', type: 'image', duration_seconds: null, size_bytes: 1000 },
        { object_key: 'audio-1.mp3', type: 'audio', duration_seconds: 8, size_bytes: 1000 },
        { object_key: 'audio-2.mp3', type: 'audio', duration_seconds: 8, size_bytes: 1000 },
      ]),
      userId: 'user-1', model: 'Seedance 2.0',
      config: {},
      references: [
        referenceInput(1, 'reference_image'),
        referenceInput(2, 'reference_audio'),
        referenceInput(3, 'reference_audio'),
      ],
    })).rejects.toThrow('参考音频总时长不能超过 15s');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'image.png', type: 'image', duration_seconds: null, size_bytes: 1000 },
        { object_key: 'large.wav', type: 'audio', duration_seconds: 5, size_bytes: 15 * 1024 * 1024 + 1 },
      ]),
      userId: 'user-1', model: 'Seedance 2.0 Mini',
      config: {},
      references: [referenceInput(1, 'reference_image'), referenceInput(2, 'reference_audio')],
    })).rejects.toThrow('单个参考音频不能超过 15 MB');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([{ object_key: 'audio.mp3', type: 'audio', duration_seconds: 5, size_bytes: 1000 }]),
      userId: 'user-1', model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_audio')],
    })).rejects.toThrow('参考音频不能单独使用');
  });

  it('首尾帧模式只接受 1 到 2 张图片并补齐 first_frame / last_frame', async () => {
    const config = await sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'first.png', type: 'image', duration_seconds: null },
        { object_key: 'last.png', type: 'image', duration_seconds: null },
      ]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: { mode: 'first-last' },
      references: [referenceInput(1, 'first_frame'), referenceInput(2, 'last_frame')],
    });

    expect(config.referenceAssets).toEqual([
      expect.objectContaining({ type: 'image', role: 'first_frame', objectKey: 'first.png' }),
      expect.objectContaining({ type: 'image', role: 'last_frame', objectKey: 'last.png' }),
    ]);

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([{ object_key: 'video-1', type: 'video', duration_seconds: 5 }]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: { mode: 'first-last' },
      references: [referenceInput(1, 'first_frame')],
    })).rejects.toThrow('首尾帧模式只支持图片素材');
  });

  it('按 assetId/role 稳定去重，同一资产不同 role 仍交给模式规则校验', async () => {
    const client = makeClient([
      { object_key: 'image.png', type: 'image', duration_seconds: null },
    ]);

    const deduplicated = await sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_image'), referenceInput(1, 'reference_image')],
    });
    expect(deduplicated.referenceAssets).toHaveLength(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('id = ANY($2::uuid[])'),
      ['user-1', ['00000000-0000-4000-8000-000000000001']],
    );

    await expect(sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: { mode: 'first-last' },
      references: [referenceInput(1, 'first_frame'), referenceInput(1, 'last_frame')],
    })).resolves.toEqual(expect.objectContaining({
      referenceAssets: [
        expect.objectContaining({ role: 'first_frame' }),
        expect.objectContaining({ role: 'last_frame' }),
      ],
    }));

    await expect(sanitizeSeedanceVideoConfig({
      client,
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: {},
      references: [referenceInput(1, 'reference_video')],
    })).rejects.toMatchObject({ code: 'INVALID_REFERENCE_ROLE', statusCode: 400 });
  });

  it('只把服务端解析后的真人引用写入内部配置且限制在全能参考模式', async () => {
    const realPortraitReference = {
      actorId: '10000000-0000-4000-8000-000000000001',
      portraitAssetId: '10000000-0000-4000-8000-000000000002',
      authorizationId: '10000000-0000-4000-8000-000000000003',
      materializationId: '10000000-0000-4000-8000-000000000004',
      authorizationVersion: 1,
      providerAssetId: 'ark-private-asset-id',
      projectName: 'default',
      providerUrl: 'asset://ark-private-asset-id' as const,
    };
    const config = await sanitizeSeedanceVideoConfig({
      client: makeClient([]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: { mode: 'general' },
      realPortraitReference,
    });

    expect(config.realPortraitReference).toEqual({
      actorId: realPortraitReference.actorId,
      portraitAssetId: realPortraitReference.portraitAssetId,
      authorizationId: realPortraitReference.authorizationId,
      materializationId: realPortraitReference.materializationId,
      authorizationVersion: 1,
      projectName: 'default',
      providerAssetUri: 'asset://ark-private-asset-id',
    });

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]),
      userId: 'user-1',
      model: 'Seedance 2.0',
      config: { mode: 'first-last' },
      realPortraitReference,
    })).rejects.toMatchObject({ code: 'REAL_PORTRAIT_GENERAL_MODE_REQUIRED' });
  });

  it('Seedance 2.5 general 支持 30 图、10 视频、10 音频和 30 秒输出', async () => {
    const images = Array.from({ length: 30 }, (_, index) => ({
      object_key: `image-${index}.png`, type: 'image', duration_seconds: null, size_bytes: 1000,
    }));
    const videos = Array.from({ length: 10 }, (_, index) => ({
      object_key: `video-${index}.mp4`, type: 'video', duration_seconds: 3, size_bytes: 1000,
    }));
    const audios = Array.from({ length: 10 }, (_, index) => ({
      object_key: `audio-${index}.mp3`, type: 'audio', duration_seconds: 3, size_bytes: 1000,
    }));
    const references = [
      ...images.map((_, index) => referenceInput(index + 1, 'reference_image')),
      ...videos.map((_, index) => referenceInput(31 + index, 'reference_video')),
      ...audios.map((_, index) => referenceInput(41 + index, 'reference_audio')),
    ];

    const config = await sanitizeSeedanceVideoConfig({
      client: makeClient([...images, ...videos, ...audios]),
      userId: 'user-1',
      model: 'Seedance 2.5',
      config: { mode: 'general', aspectRatio: '16:9', resolution: '720p', durationSeconds: 30 },
      references,
    });

    expect(config).toEqual(expect.objectContaining({
      mode: 'general',
      aspectRatio: '16:9',
      resolution: '720p',
      durationSeconds: 30,
      generateAudio: true,
    }));
    expect(config.referenceAssets).toHaveLength(50);
  });

  it('Seedance 2.5 独立执行素材数量与视频、音频累计 30 秒上限', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient(Array.from({ length: 31 }, (_, index) => ({
        object_key: `image-${index}.png`, type: 'image', duration_seconds: null,
      }))),
      userId: 'user-1', model: 'Seedance 2.5', config: {},
      references: Array.from({ length: 31 }, (_, index) => referenceInput(index + 1, 'reference_image')),
    })).rejects.toThrow('Seedance 2.5 最多支持 30 张参考图片');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'video-1.mp4', type: 'video', duration_seconds: 15.1 },
        { object_key: 'video-2.mp4', type: 'video', duration_seconds: 15.1 },
      ]),
      userId: 'user-1', model: 'Seedance 2.5', config: {},
      references: [referenceInput(1, 'reference_video'), referenceInput(2, 'reference_video')],
    })).rejects.toThrow('参考视频总时长不能超过 30s');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'audio-1.mp3', type: 'audio', duration_seconds: 15.1, size_bytes: 1000 },
        { object_key: 'audio-2.wav', type: 'audio', duration_seconds: 15.1, size_bytes: 1000 },
      ]),
      userId: 'user-1', model: 'Seedance 2.5', config: {},
      references: [referenceInput(1, 'reference_audio'), referenceInput(2, 'reference_audio')],
    })).rejects.toThrow('参考音频总时长不能超过 30s');
  });

  it('Seedance 2.5 允许纯音频，并让首尾帧固定使用 adaptive', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'audio.mp3', type: 'audio', duration_seconds: 5, size_bytes: 1000 },
      ]),
      userId: 'user-1', model: 'Seedance 2.5', config: { durationSeconds: 25 },
      references: [referenceInput(1, 'reference_audio')],
    })).resolves.toEqual(expect.objectContaining({
      durationSeconds: 25,
      referenceAssets: [expect.objectContaining({ role: 'reference_audio' })],
    }));

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([
        { object_key: 'first.png', type: 'image', duration_seconds: null, width: 1200, height: 800 },
        { object_key: 'last.png', type: 'image', duration_seconds: null, width: 1200, height: 800 },
      ]),
      userId: 'user-1', model: 'Seedance 2.5',
      config: { mode: 'first-last', resolution: '480p', durationSeconds: 30 },
      references: [referenceInput(1, 'first_frame'), referenceInput(2, 'last_frame')],
    })).resolves.toEqual(expect.objectContaining({ aspectRatio: 'adaptive', durationSeconds: 30 }));

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([{ object_key: 'first.png', type: 'image', duration_seconds: null }]),
      userId: 'user-1', model: 'Seedance 2.5',
      config: { mode: 'first-last', aspectRatio: '16:9' },
      references: [referenceInput(1, 'first_frame')],
    })).rejects.toThrow('当前视频比例暂不开放');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([{ object_key: 'first.png', type: 'image', duration_seconds: null }]),
      userId: 'user-1', model: 'Seedance 2.5',
      config: { mode: 'first-last' },
      references: [referenceInput(1, 'first_frame')],
    })).rejects.toThrow('首帧尺寸信息不完整，请重新上传或等待处理');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]), userId: 'user-1', model: 'Seedance 2.5',
      config: { mode: 'general', aspectRatio: 'adaptive' },
    })).rejects.toThrow('当前视频比例暂不开放');
  });

  it('Seedance 2.5 拒绝 1080p 和真人演员，同时不扩大 2.0 时长范围', async () => {
    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]), userId: 'user-1', model: 'Seedance 2.5',
      config: { resolution: '1080p' },
    })).rejects.toThrow('Seedance 2.5 当前不支持 1080p 分辨率');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]), userId: 'user-1', model: 'Seedance 2.0',
      config: { durationSeconds: 20 },
    })).rejects.toThrow('当前视频时长暂不开放');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]), userId: 'user-1', model: 'Seedance 2.0',
      config: { durationSeconds: 25 },
    })).rejects.toThrow('当前视频时长暂不开放');

    await expect(sanitizeSeedanceVideoConfig({
      client: makeClient([]), userId: 'user-1', model: 'Seedance 2.5', config: {},
      realPortraitReference: {
        actorId: '10000000-0000-4000-8000-000000000001',
        portraitAssetId: '10000000-0000-4000-8000-000000000002',
        authorizationId: '10000000-0000-4000-8000-000000000003',
        materializationId: '10000000-0000-4000-8000-000000000004',
        authorizationVersion: 1,
        providerAssetId: 'ark-private-asset-id',
        projectName: 'default',
        providerUrl: 'asset://ark-private-asset-id',
      },
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_MODEL_UNSUPPORTED',
      message: 'Seedance 2.5 暂不支持真人演员',
    });
  });
});

function referenceInput(index: number, role: 'reference_image' | 'reference_video' | 'reference_audio' | 'first_frame' | 'last_frame') {
  return {
    assetId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    role,
  };
}

function makeClient(rows: Array<{
  id?: string;
  user_id?: string;
  name?: string;
  object_key: string;
  thumbnail_key?: string | null;
  type: string;
  duration_seconds: number | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
}>): DbClient {
  const normalizedRows = rows.map((row, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    user_id: 'user-1',
    name: `参考素材 ${index + 1}`,
    thumbnail_key: null,
    size_bytes: null,
    ...row,
  }));
  return {
    query: vi.fn().mockResolvedValue({ rowCount: normalizedRows.length, rows: normalizedRows }),
  } as unknown as DbClient;
}
