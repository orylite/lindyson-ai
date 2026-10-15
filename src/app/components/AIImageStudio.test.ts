import { describe,expect,it,vi } from 'vitest';
import type { Asset,ImageAssetGenerationMeta } from '../data/assets';
import type { ConsumptionSettings } from '../data/consumption';
import {
  getImageGenerationCreditSummary,
  insertImageAnnotationToken,
  insertImagePromptMentionToken,
  remapImageReferenceMentions,
  reorderImageReferences,
  resolveImageGenerationDraft,
  syncAnnotationsAfterPromptChange,
  validateImagePromptAnnotations,
  validateImagePromptMentions,
  validateImagePromptReferences,
} from './AIImageStudio';

describe('AI 图片参考图排序', () => {
  it('只改变数组顺序，保留引用对象和 assetId', () => {
    const first = { id: 'asset-1' };
    const second = { id: 'asset-2' };
    expect(reorderImageReferences([first, second], 1, -1)).toEqual([second, first]);
    expect(reorderImageReferences([first, second], 0, -1)).toEqual([first, second]);
  });
});

describe('AI 图片标记与提示词契约', () => {
  const annotation = {
    token: '@标记1' as const,
    assetId: 'asset-1',
    type: 'point' as const,
    x: 500,
    y: 500,
  };

  it('每个标记必须在 Prompt 中恰好出现一次', () => {
    expect(validateImagePromptAnnotations('替换@标记1的主体', [annotation])).toBeNull();
    expect(validateImagePromptAnnotations('替换主体', [annotation])).toContain('必须在提示词中出现');
    expect(validateImagePromptAnnotations('@标记1与@标记1', [annotation])).toContain('只能出现一次');
  });

  it('拒绝没有画布标记的 token', () => {
    expect(validateImagePromptAnnotations('编辑@标记9', [annotation])).toBe('@标记9 没有对应的画布标记');
  });

  it('从 Prompt 删除 token 会同步删除标记，且不会把 @标记10 误认成 @标记1', () => {
    const annotationTen = { ...annotation, token: '@标记10' as const };
    expect(syncAnnotationsAfterPromptChange(
      '编辑@标记1和@标记10',
      '只编辑@标记10',
      [annotation, annotationTen],
    )).toEqual([annotationTen]);
  });

  it('在 @ 触发位置插入选中的 @标记N，并替换尚未完成的触发文本', () => {
    expect(insertImageAnnotationToken('请把@标', '@标记3', 2, 4)).toEqual({
      prompt: '请把 @标记3 ',
      caret: 8,
      inserted: true,
    });
    expect(insertImageAnnotationToken('编辑@标记3', '@标记3', 2, 7)).toEqual({
      prompt: '编辑@标记3',
      caret: 7,
      inserted: false,
    });
  });
});

describe('AI 图片参考图与提示词契约', () => {
  const references = [{ id: 'asset-1' }, { id: 'asset-2' }];
  const annotation = {
    token: '@标记1' as const,
    assetId: 'asset-1',
    type: 'point' as const,
    x: 500,
    y: 500,
  };

  it('拒绝缺编号、0、非法格式和越界的 @图片N', () => {
    expect(validateImagePromptReferences('参考@图片', references)).toContain('无法识别');
    expect(validateImagePromptReferences('参考@图片0', references)).toContain('无法识别');
    expect(validateImagePromptReferences('参考@图片A', references)).toContain('无法识别');
    expect(validateImagePromptReferences('参考@图片1abc', references)).toContain('无法识别');
    expect(validateImagePromptReferences('参考@图片1.5', references)).toContain('无法识别');
    expect(validateImagePromptReferences('参考@图片1-2', references)).toContain('无法识别');
    expect(validateImagePromptReferences('参考@图片1/2', references)).toContain('无法识别');
    expect(validateImagePromptReferences('参考@图片3', references)).toBe('提示词只能引用当前的 @图片1 至 @图片2');
    expect(validateImagePromptReferences('参考@图片1和@图片2', references)).toBeNull();
    expect(validateImagePromptReferences('保留@图片1中的主体', references)).toBeNull();
  });

  it('@图片N 与 @标记N 可以同时校验', () => {
    expect(validateImagePromptMentions('参考@图片1并编辑@标记1', [annotation], references)).toBeNull();
    expect(validateImagePromptMentions('参考@图片0并编辑@标记1', [annotation], references)).toContain('无法识别');
    expect(validateImagePromptMentions('参考@图片1并编辑@标记9', [annotation], references)).toBe('@标记9 没有对应的画布标记');
  });

  it('按 assetId 重写引用，重排保持原资产，删除后紧缩编号', () => {
    const previous = [{ id: 'asset-a' }, { id: 'asset-b' }, { id: 'asset-c' }];
    expect(remapImageReferenceMentions(
      '主图 @图片1；辅图 @图片2；背景 @图片3',
      previous,
      [{ id: 'asset-c' }, { id: 'asset-a' }],
    )).toBe('主图 @图片2；辅图；背景 @图片1');
    expect(remapImageReferenceMentions(
      '@图片1与@图片2保持各自语义',
      previous.slice(0, 2),
      [previous[1], previous[0]],
    )).toBe('@图片2与@图片1保持各自语义');
  });

  it('可在 @ 触发位置插入 @图片N，且允许重复引用同一图片', () => {
    expect(insertImagePromptMentionToken('请参考@图', '@图片2', 3, 5)).toEqual({
      prompt: '请参考 @图片2 ',
      caret: 9,
      inserted: true,
    });
    expect(insertImagePromptMentionToken('先看@图片1，再看@图', '@图片1', 9, 11)).toEqual({
      prompt: '先看@图片1，再看 @图片1 ',
      caret: 15,
      inserted: true,
    });
  });
});

describe('AI 图片批量积分', () => {
  const settings: ConsumptionSettings = {
    video: [],
    image: [
      { id: '1k', model: 'seedream-5.0-pro', modelLabel: 'Seedream 5.0 Pro', resolution: '1K', credits: 14, available: true },
      { id: '2k', model: 'seedream-5.0-pro', modelLabel: 'Seedream 5.0 Pro', resolution: '2K', credits: 28, available: true },
    ],
    promptWizard: { generationCredits: 1, available: false, engineVersion: 4, updatedAt: '' },
  };

  it('按分辨率单价乘以 1–4 个独立任务计算合计', () => {
    expect([1, 2, 3, 4].map(quantity => getImageGenerationCreditSummary(settings, '1K', quantity)))
      .toEqual([
        { perImage: 14, total: 14 },
        { perImage: 14, total: 28 },
        { perImage: 14, total: 42 },
        { perImage: 14, total: 56 },
      ]);
    expect(getImageGenerationCreditSummary(settings, '2K', 4)).toEqual({ perImage: 28, total: 112 });
  });
});

describe('AI 图片沿用生成引用恢复', () => {
  it('即使历史 preview 仍存在，也会按 assetId 验证活动状态并清理失效标记', async () => {
    const loadDetail = vi.fn().mockRejectedValue(new Error('404'));
    const result = await resolveImageGenerationDraft(imageDraft(), [], loadDetail);

    expect(loadDetail).toHaveBeenCalledWith('asset-1');
    expect(result.references).toEqual([]);
    expect(result.annotations).toEqual([]);
    expect(result.prompt).toBe('替换的主体');
    expect(result.unavailableCount).toBe(1);
  });

  it('当前活动资产可直接恢复，排序和 assetId 标记保持不变', async () => {
    const currentAsset = imageAsset('asset-1');
    const loadDetail = vi.fn();
    const result = await resolveImageGenerationDraft(imageDraft(), [currentAsset], loadDetail);

    expect(loadDetail).not.toHaveBeenCalled();
    expect(result.references[0]).toMatchObject({ id: 'asset-1', type: 'image' });
    expect(result.references[0]).toMatchObject({ width: 1024, height: 1024, mediaExtension: 'png' });
    expect(result.annotations[0]).toMatchObject({ token: '@标记1', assetId: 'asset-1' });
    expect(result.prompt).toBe('替换@标记1的主体');
  });

  it('失效历史参考图会移除对应引用，并按存活 assetId 重新编号', async () => {
    const draft: ImageAssetGenerationMeta = {
      ...imageDraft(),
      prompt: '主图@图片1，辅图@图片2，编辑@标记1与@标记2',
      referenceImages: [
        { id: 'asset-1', name: '失效参考图', thumbnail: 'https://expired.example.com/old.jpg' },
        { id: 'asset-2', name: '活动参考图', thumbnail: 'https://cdn.example.com/current.jpg' },
      ],
      annotations: [
        { token: '@标记1', assetId: 'asset-1', type: 'point', x: 500, y: 500 },
        { token: '@标记2', assetId: 'asset-2', type: 'point', x: 250, y: 250 },
      ],
    };
    const loadDetail = vi.fn().mockRejectedValue(new Error('404'));
    const result = await resolveImageGenerationDraft(draft, [imageAsset('asset-2')], loadDetail);

    expect(result.references.map(reference => reference.id)).toEqual(['asset-2']);
    expect(result.annotations.map(item => item.token)).toEqual(['@标记2']);
    expect(result.prompt).not.toContain('@图片2');
    expect(result.prompt).toContain('@图片1');
    expect(result.prompt).not.toContain('@标记1');
    expect(result.prompt).toContain('@标记2');
    expect(result.unavailableCount).toBe(1);
  });
});

function imageDraft(): ImageAssetGenerationMeta {
  return {
    kind: 'image',
    model: 'Seedream 5.0 Pro',
    prompt: '替换@标记1的主体',
    outputSize: '2K',
    ratio: '1:1',
    resolution: '2K',
    optimizePromptMode: 'standard',
    referenceImages: [{
      id: 'asset-1',
      name: '历史参考图',
      thumbnail: 'https://expired.example.com/old.jpg',
    }],
    annotations: [{ token: '@标记1', assetId: 'asset-1', type: 'point', x: 500, y: 500 }],
  };
}

function imageAsset(id: string): Asset {
  return {
    id,
    name: '活动参考图',
    type: 'image',
    source: 'uploaded-image',
    folderId: null,
    size: '1 MB',
    sizeBytes: 1024,
    width: 1024,
    height: 1024,
    dimensions: '1024×1024',
    mediaExtension: 'png',
    createdAt: '2026-07-27 12:00',
    updatedAt: '2026-07-27 12:00',
    thumbnail: 'https://cdn.example.com/current.jpg',
    publicUrl: 'https://cdn.example.com/current.jpg',
    views: 0,
  };
}
