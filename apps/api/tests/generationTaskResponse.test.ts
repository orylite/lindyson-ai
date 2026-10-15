import { describe, expect, it } from 'vitest';
import { mapSafeGenerationTaskConfig } from '../src/domain/generationTaskResponse.js';

describe('generationTaskResponse', () => {
  it('规范化历史引用并剥离对象 key、存储 URL 和重复记录', () => {
    const assetId = '11111111-1111-4111-8111-111111111111';
    const result = mapSafeGenerationTaskConfig({
      mode: 'general',
      aspectRatio: '9:16',
      resolution: '720p',
      durationSeconds: 5,
      referenceAssets: [{
        id: assetId,
        name: '参考图',
        type: 'image',
        role: 'reference_image',
        objectKey: 'users/user-1/private.png',
        thumbnailKey: 'users/user-1/private-thumb.webp',
        publicUrl: 'https://signed.example.com/original',
        thumbnailUrl: 'https://signed.example.com/thumbnail',
        sizeBytes: 1024,
        width: 1200,
        height: 800,
      }],
      referenceImages: [{
        id: assetId,
        name: '同一历史参考图',
        role: 'reference_image',
        objectKey: 'users/user-1/private.png',
      }],
    });

    expect(result).toEqual({
      mode: 'general',
      aspectRatio: '9:16',
      resolution: '720p',
      durationSeconds: 5,
      referenceAssets: [{
        id: assetId,
        name: '参考图',
        type: 'image',
        role: 'reference_image',
        previewUrl: null,
        sizeBytes: 1024,
        width: 1200,
        height: 800,
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(/objectKey|thumbnailKey|publicUrl|thumbnailUrl|signed\.example/);
  });

  it('真人任务响应仅返回站内 UUID，不泄露火山 Asset ID 或项目名', () => {
    const actorId = '20000000-0000-4000-8000-000000000001';
    const portraitAssetId = '20000000-0000-4000-8000-000000000002';
    const result = mapSafeGenerationTaskConfig({
      realPortraitReference: {
        actorId,
        portraitAssetId,
        authorizationId: '20000000-0000-4000-8000-000000000003',
        providerAssetUri: 'asset://ark-secret-id',
        projectName: 'default',
      },
    });

    expect(result).toEqual({ realPortrait: { actorId, portraitAssetId } });
    expect(JSON.stringify(result)).not.toMatch(/ark-secret-id|providerAssetUri|projectName|authorizationId/);
  });
});
