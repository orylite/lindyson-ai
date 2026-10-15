import { describe,expect,it,vi } from 'vitest';
import {
  buildGenerationIdempotencyFingerprint,
  buildGenerationQueueQueryKeys,
  createGenerationIdempotencyRegistry,
  GENERATION_POLL_SCHEDULE_MS,
  GENERATION_QUEUE_PAGE_SIZE,
  generationPollDelayMs,
  isGenerationPollVisible,
  isGenerationQueueQueryEnabled,
  settleGenerationRefreshes,
} from './useGeneration';
import type {
  ImageGenerationReserveRequest,
  VideoGenerationReserveRequest,
} from '../data/admin';

describe('AI Studio 生成队列分页', () => {
  it('每页只请求并展示 12 个任务', () => {
    expect(GENERATION_QUEUE_PAGE_SIZE).toBe(12);
  });

  it('视频与图片分页请求使用独立 kind 和独立游标状态', () => {
    const initial = buildGenerationQueueQueryKeys(
      3,
      { limit: 12, position: 'first' },
      { limit: 12, position: 'next', cursor: 'image-page-2' },
    );
    const videoMoved = buildGenerationQueueQueryKeys(
      3,
      { limit: 12, position: 'next', cursor: 'video-page-2' },
      { limit: 12, position: 'next', cursor: 'image-page-2' },
    );

    expect(videoMoved.image).toEqual(initial.image);
    expect(videoMoved.video).not.toEqual(initial.video);
    expect(videoMoved.video).toContain('video');
    expect(videoMoved.image).toContain('image');

    const imageMoved = buildGenerationQueueQueryKeys(
      3,
      { limit: 12, position: 'first' },
      { limit: 12, position: 'last' },
    );
    expect(imageMoved.video).toEqual(initial.video);
    expect(imageMoved.image).not.toEqual(initial.image);
  });

  it('图片队列只在首次访问图片工作区后启用，视频队列保持立即启用', () => {
    expect(isGenerationQueueQueryEnabled('video', true, false)).toBe(true);
    expect(isGenerationQueueQueryEnabled('image', true, false)).toBe(false);
    expect(isGenerationQueueQueryEnabled('image', true, true)).toBe(true);
    expect(isGenerationQueueQueryEnabled('image', false, true)).toBe(false);
  });
});

describe('进行中任务的轮询节奏', () => {
  it('轮询间隔随等待时长递增：3 秒、5 秒、10 秒', () => {
    expect(generationPollDelayMs(0)).toBe(3_000);
    expect(generationPollDelayMs(29_999)).toBe(3_000);
    expect(generationPollDelayMs(30_000)).toBe(5_000);
    expect(generationPollDelayMs(119_999)).toBe(5_000);
    expect(generationPollDelayMs(120_000)).toBe(10_000);
    expect(generationPollDelayMs(60 * 60_000)).toBe(10_000);
  });

  it('异常的等待时长按刚开始处理，且最慢不超过 10 秒', () => {
    expect(generationPollDelayMs(-5)).toBe(3_000);
    expect(generationPollDelayMs(Number.NaN)).toBe(3_000);
    expect(generationPollDelayMs(Number.POSITIVE_INFINITY)).toBe(10_000);
    const slowest = GENERATION_POLL_SCHEDULE_MS[GENERATION_POLL_SCHEDULE_MS.length - 1];
    expect(slowest.intervalMs).toBe(10_000);
  });

  it('页面切到后台时暂停，前台或未知可见性时继续', () => {
    expect(isGenerationPollVisible('hidden')).toBe(false);
    expect(isGenerationPollVisible('visible')).toBe(true);
    expect(isGenerationPollVisible(undefined)).toBe(true);
  });
});

describe('批量生成核心成功后的幂等保护', () => {
  it('视频来源与真人肖像参与幂等指纹', () => {
    const baseRequest = {
      kind: 'video',
      model: 'Seedance 2.0',
      prompt: '生成测试视频',
      config: {
        mode: 'general',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 10,
      },
      references: [{
        assetId: '00000000-0000-4000-8000-000000000001',
        role: 'reference_image',
      }],
    } satisfies VideoGenerationReserveRequest;
    const fingerprints = [
      buildGenerationIdempotencyFingerprint([baseRequest]),
      buildGenerationIdempotencyFingerprint([{
        ...baseRequest,
        realPortrait: {
          actorId: '00000000-0000-4000-8000-000000000002',
          portraitAssetId: '00000000-0000-4000-8000-000000000003',
        },
      }]),
      buildGenerationIdempotencyFingerprint([{
        ...baseRequest,
        promptWizardSource: {
          runId: '00000000-0000-4000-8000-000000000004',
          batchId: '00000000-0000-4000-8000-000000000005',
          planId: '00000000-0000-4000-8000-000000000006',
          engineVersion: 4,
          editBucket: 'none',
        },
      }]),
      buildGenerationIdempotencyFingerprint([{
        ...baseRequest,
        tkPromptSource: {
          runId: '00000000-0000-4000-8000-000000000007',
          generationId: '00000000-0000-4000-8000-000000000008',
          optionId: '00000000-0000-4000-8000-000000000009',
          schemaVersion: 1,
          editBucket: 'none',
        },
      }]),
    ];

    expect(new Set(fingerprints)).toHaveLength(4);
    expect(fingerprints[1]).toContain('realPortrait');
    expect(fingerprints[2]).toContain('promptWizardSource');
    expect(fingerprints[3]).toContain('tkPromptSource');
  });

  it('图片请求的幂等指纹保持原有序列化行为', () => {
    const request: ImageGenerationReserveRequest = {
      kind: 'image',
      model: 'Seedream 5.0 Pro',
      prompt: '生成测试图片',
      config: {
        resolution: '2K',
        aspectRatio: '1:1',
        optimizePromptMode: 'standard',
      },
      references: [{
        assetId: '00000000-0000-4000-8000-000000000010',
        role: 'reference_image',
      }],
      annotations: [{
        token: '@标记1',
        assetId: '00000000-0000-4000-8000-000000000010',
        type: 'point',
        x: 0.25,
        y: 0.75,
      }],
    };

    expect(buildGenerationIdempotencyFingerprint([request])).toBe(JSON.stringify([{
      kind: request.kind,
      model: request.model,
      prompt: request.prompt,
      config: request.config,
      references: request.references,
      annotations: request.annotations,
    }]));
  });

  it('次要刷新失败不会抛出，并报告需保留幂等键', async () => {
    await expect(settleGenerationRefreshes([
      Promise.resolve(),
      Promise.reject(new Error('refresh failed')),
    ])).resolves.toBe(false);
  });

  it('释放前相同请求始终复用同一幂等键', () => {
    const createKey = vi.fn()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2');
    const registry = createGenerationIdempotencyRegistry(createKey);

    expect(registry.get('same-request')).toBe('key-1');
    expect(registry.get('same-request')).toBe('key-1');
    expect(createKey).toHaveBeenCalledTimes(1);

    registry.release('same-request');
    expect(registry.get('same-request')).toBe('key-2');
  });

});
