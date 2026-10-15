import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Asset, AssetReferenceAsset } from '../data/assets';
import type { AdminGenerationJob } from '../data/admin';
import { DEFAULT_VIDEO_MODEL_CAPABILITIES } from '../data/consumption';
import {
  buildGenerationDraftFromJob,
  getFrameCapabilityViolation,
  getFrameAssetSelectionRules,
  getReferenceCapabilityViolation,
  getReferenceMentionOptions,
  getReferenceMenuHorizontalBounds,
  loadAIStudioQueueAssetDetail,
  loadFailedGenerationDraft,
  mergePromptEditBuckets,
  reconcileVideoConfiguration,
  removeUnavailableReferenceMentions,
  tkPromptReferenceAssetsEqual,
} from './AIStudio';

function reference(
  id: string,
  type: AssetReferenceAsset['type'],
  previewUrl?: string,
): AssetReferenceAsset {
  return {
    id,
    name: id,
    thumbnail: previewUrl ?? '',
    type,
  };
}

describe('AI Studio 历史参考素材降级', () => {
  it('移除失效素材后会按媒体类型同步删除并重排提示词编号', () => {
    const prompt = '使用 @图片1、@图片2、@图片3，并参考 @视频1 与 @音频1';
    const references = [
      reference('失效图片一', 'image'),
      reference('有效图片', 'image', 'https://cdn.example.com/image.webp'),
      reference('失效图片三', 'image'),
      reference('有效视频', 'video', 'https://cdn.example.com/video.webp'),
      reference('失效音频', 'audio'),
    ];

    const result = removeUnavailableReferenceMentions(prompt, references);

    expect(result).toContain('@图片1');
    expect(result).not.toContain('@图片2');
    expect(result).not.toContain('@图片3');
    expect(result).toContain('@视频1');
    expect(result).not.toContain('@音频1');
  });
});

describe('AI Studio 生成队列素材详情', () => {
  it('始终按 assetId 加载详情，避免把没有原文件地址的卡片当作详情', async () => {
    const detail = {
      id: 'asset-video',
      name: '生成视频',
      type: 'video',
      publicUrl: 'https://cdn.example.com/video.mp4',
    } as Asset;
    const loadDetail = vi.fn().mockResolvedValue(detail);

    await expect(loadAIStudioQueueAssetDetail({ assetId: detail.id }, loadDetail)).resolves.toBe(detail);
    expect(loadDetail).toHaveBeenCalledOnce();
    expect(loadDetail).toHaveBeenCalledWith(detail.id);
  });

  it('任务没有 assetId 时不请求详情', async () => {
    const loadDetail = vi.fn();

    await expect(loadAIStudioQueueAssetDetail({}, loadDetail)).resolves.toBeNull();
    expect(loadDetail).not.toHaveBeenCalled();
  });
});

describe('AI Studio 应用提示词向导草稿', () => {
  it('生成前保留应用时已有的最高编辑幅度', () => {
    expect(mergePromptEditBuckets('none', 'minor')).toBe('minor');
    expect(mergePromptEditBuckets('minor', 'none')).toBe('minor');
    expect(mergePromptEditBuckets('minor', 'material')).toBe('material');
  });

  it('TK来源只在参考素材ID、类型和顺序完全相同时保留', () => {
    const original = [
      reference('image-a', 'image'),
      reference('image-b', 'image'),
    ];

    expect(tkPromptReferenceAssetsEqual(original, [...original])).toBe(true);
    expect(tkPromptReferenceAssetsEqual(original, [...original].reverse())).toBe(false);
    expect(tkPromptReferenceAssetsEqual(original, [reference('image-a', 'image')])).toBe(false);
    expect(tkPromptReferenceAssetsEqual(original, [
      reference('image-a', 'image'),
      reference('image-b', 'video'),
    ])).toBe(false);
  });

  it('所有来源快照结构字段都通过转手动草稿处理器修改', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');
    const controlsStart = source.indexOf('const handleReferenceModeChange');
    const controlsEnd = source.indexOf('const handleReferenceAssetsConfirm', controlsStart);
    const controls = source.slice(controlsStart, controlsEnd);

    for (const reason of ['参考模式', '视频模型', '视频分辨率', '画面比例', '视频时长']) {
      expect(controls).toContain(`detachAppliedTkPrompt('${reason}')`);
    }
    expect(source).toContain("detachAppliedTkPrompt('商品参考素材')");
    expect(source).toContain("detachAppliedTkPrompt('真人演员选择')");
    expect(source).not.toContain("detachAppliedTkPrompt('真人演员授权状态')");
    expect(source).not.toContain("detachAppliedTkPrompt('真人演员素材')");
    expect(source).toContain('已转为手动草稿，提交时不再关联原方案');
  });
});

describe('AI Studio 素材菜单横向边界', () => {
  it('正常位置从光标处展开并使用首选宽度', () => {
    expect(getReferenceMenuHorizontalBounds(72, 520)).toEqual({ left: 72, width: 320 });
  });

  it('光标靠近右侧时向左收敛', () => {
    expect(getReferenceMenuHorizontalBounds(480, 520)).toEqual({ left: 192, width: 320 });
  });

  it('窄输入框中缩小宽度并保留两侧间距', () => {
    expect(getReferenceMenuHorizontalBounds(120, 280)).toEqual({ left: 8, width: 264 });
  });
});

describe('AI Studio 真人演员生成边界', () => {
  it('TK方案应用只写入商品图，不携演员ID或真人素材', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');
    const start = source.indexOf('const applyTkPromptDraft');
    const end = source.indexOf('const openFrameAssetPicker', start);
    const apply = source.slice(start, end);

    expect(apply).toContain('setSelectedReferenceAssets(nextImages)');
    expect(apply).toContain('setSelectedRealPortraitActorId(null)');
    expect(apply).toContain('setSelectedRealPortraitAssetId(null)');
    expect(apply).not.toMatch(/draft\.realPortrait|resolveTkPromptPortraitSelection|authorizedActorAssetId/u);
  });

  it('切换首尾帧保留演员选择，但提交仍限制为全能参考模式', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');

    const modeChange = source.slice(source.indexOf('const handleReferenceModeChange'), source.indexOf('const handleModelChange'));
    expect(modeChange).not.toContain('setSelectedRealPortraitActorId');
    expect(modeChange).not.toContain('setSelectedRealPortraitAssetId');
    expect(source).toContain("if (selectedRealPortraitActor && referenceMode !== 'general')");
    expect(source).toContain('真人演员仅支持全能参考模式');
  });

  it('一次生成仅提交站内 actorId 和可选素材 ID，绝不把供应商标识传到浏览器请求中', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');
    const start = source.indexOf('...(selectedRealPortraitActor ? {');
    const end = source.indexOf('} : {}),', start);
    const realPortraitPayload = source.slice(start, end);

    expect(realPortraitPayload).toContain('actorId: selectedRealPortraitActor.id');
    expect(realPortraitPayload).toContain('portraitAssetId: selectedRealPortraitAsset.id');
    expect(realPortraitPayload).not.toMatch(/asset:\/\/|provider|ark|groupId|providerAssetId/i);
  });

  it('切换到未适配模型时保留已选真人演员，并提供显式移除入口', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');
    const start = source.indexOf('const handleModelChange');
    const end = source.indexOf('const handleReferenceAssetsConfirm', start);
    const modelChange = source.slice(start, end);

    expect(modelChange).not.toContain('setSelectedRealPortraitActorId(null)');
    expect(modelChange).not.toContain('setSelectedRealPortraitAssetId(null)');
    const controls = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudioVideoControls.tsx'), 'utf8');
    expect(controls).toContain('已保留：${selectedRealPortraitActor.alias}');
    expect(controls).toContain('不使用真人演员');
  });
});

describe('AI Studio 视频默认参数与模型降档', () => {
  it('默认使用全能参考、Seedance 2.0、9:16、480p、15 秒和 1 条', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');

    expect(source).toContain("useState<VideoModel>('seedance-2.0')");
    expect(source).toContain("useState<ReferenceMode>('general')");
    expect(source).toContain("useState<AspectRatio>('9:16')");
    expect(source).toContain("useState<Resolution>('480p')");
    expect(source).toContain("useState<Duration>('15')");
    expect(source).toContain('useState(1)');
  });

  it('切换到 Seedance 2.5 时只回落标量，首尾帧比例跟随首帧', () => {
    expect(reconcileVideoConfiguration(DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.5'], {
      mode: 'first-last',
      aspectRatio: '16:9',
      resolution: '1080p',
      duration: '15',
    })).toEqual({
      mode: 'first-last',
      aspectRatio: 'adaptive',
      resolution: '720p',
      duration: '15',
      adjusted: ['画面比例', '分辨率'],
    });
  });

  it('Seedance 2.5 保留 25 秒，切回 Seedance 2.0 时回落到最近的 15 秒', () => {
    expect(reconcileVideoConfiguration(DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.5'], {
      mode: 'general', aspectRatio: '9:16', resolution: '720p', duration: '25',
    }).duration).toBe('25');
    expect(reconcileVideoConfiguration(DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.0'], {
      mode: 'general', aspectRatio: '9:16', resolution: '720p', duration: '25',
    }).duration).toBe('15');
  });

  it('失败任务按钮明确表达修改参数后创建重试任务', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudioResults.tsx'), 'utf8');
    expect(source).toContain("'修改参数并重试'");
    expect(source).not.toContain("'修改参数重试'");
  });
});

describe('AI Studio Seedance 2.5 参考素材体验', () => {
  it('@ 菜单按类型分组并支持名称与类型过滤', () => {
    const assets = [
      { ...reference('voice.wav', 'audio', 'https://cdn.example.com/audio'), name: '旁白.wav' },
      { ...reference('hero.png', 'image', 'https://cdn.example.com/image'), name: '主角.png' },
      { ...reference('move.mp4', 'video', 'https://cdn.example.com/video'), name: '运镜.mp4' },
    ];

    expect(getReferenceMentionOptions(assets, '').map(option => option.asset.type)).toEqual(['image', 'video', 'audio']);
    expect(getReferenceMentionOptions(assets, '运镜').map(option => option.asset.name)).toEqual(['运镜.mp4']);
    expect(getReferenceMentionOptions(assets, '音频').map(option => option.asset.name)).toEqual(['旁白.wav']);
  });

  it('2.5 允许纯音频并分别校验 50 个总数与 30 秒音视频总时长', () => {
    const capability = DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.5'];
    expect(getReferenceCapabilityViolation([
      { ...reference('voice.wav', 'audio', 'https://cdn.example.com/audio'), durationSeconds: 30 },
    ], capability)).toBeNull();
    expect(getReferenceCapabilityViolation([
      { ...reference('voice-a.wav', 'audio', 'https://cdn.example.com/audio-a'), durationSeconds: 16 },
      { ...reference('voice-b.wav', 'audio', 'https://cdn.example.com/audio-b'), durationSeconds: 15 },
    ], capability)).toContain('30s');
  });

  it('失败任务载入时保留 Seedance 2.5、25 秒和 adaptive，不降级成 2.0', () => {
    const asset = {
      id: 'asset-1', name: '首帧.png', type: 'image', source: 'uploaded-image', folderId: null,
      size: '1 MB', createdAt: '', updatedAt: '', thumbnail: 'https://cdn.example.com/frame.png', views: 0,
    } satisfies Asset;
    const job = {
      id: 'job-1', kind: 'video', model: 'Seedance 2.5', prompt: '失败任务提示词', duration: '25s',
      configData: {
        mode: 'first-last', aspectRatio: 'adaptive', resolution: '720p', durationSeconds: 25,
        referenceAssets: [{ id: asset.id, name: asset.name, type: 'image', role: 'first_frame' }],
      },
    } as unknown as AdminGenerationJob;

    expect(buildGenerationDraftFromJob(job, [asset])).toMatchObject({
      model: 'Seedance 2.5', duration: '25s', aspectRatio: 'adaptive', resolution: '720p',
      referenceAssets: [{ id: asset.id, role: 'first_frame' }],
    });
  });

  it('失败重试先加载详情，且素材不在当前资产页时使用详情签名地址恢复', async () => {
    const detail = {
      id: 'job-detail', kind: 'video', model: 'Seedance 2.5', prompt: '来自详情的完整提示词', duration: '30s',
      configData: {
        mode: 'general', aspectRatio: '16:9', resolution: '720p', durationSeconds: 30,
        referenceAssets: [
          { id: 'off-page-image', name: '页外图片.png', type: 'image', role: 'reference_image', previewUrl: 'https://signed.example.com/image.png' },
          { id: 'missing-asset', name: '已删除视频.mp4', type: 'video', role: 'reference_video', previewUrl: null },
          { id: 'off-page-audio', name: '页外音频.wav', type: 'audio', role: 'reference_audio', previewUrl: 'https://signed.example.com/audio.wav' },
        ],
      },
    } as unknown as AdminGenerationJob;
    const loadDetail = vi.fn().mockResolvedValue(detail);

    await expect(loadFailedGenerationDraft('job-detail', [], loadDetail)).resolves.toMatchObject({
      prompt: '来自详情的完整提示词',
      referenceAssets: [
        { id: 'off-page-image', thumbnail: 'https://signed.example.com/image.png', publicUrl: 'https://signed.example.com/image.png' },
        { id: 'missing-asset', thumbnail: '' },
        { id: 'off-page-audio', thumbnail: 'https://signed.example.com/audio.wav', publicUrl: 'https://signed.example.com/audio.wav' },
      ],
    });
    expect(loadDetail).toHaveBeenCalledWith('job-detail');
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');
    expect(source).toContain('referenceRestoreWarning');
    expect(source).toContain('参数已恢复，但');
  });

  it('Seedance 2.5 首尾帧在选择阶段要求素材宽高元数据', () => {
    expect(getFrameAssetSelectionRules('seedance-2.5')).toMatchObject({ image: { requireDimensions: true } });
    expect(getFrameAssetSelectionRules('seedance-2.0')).not.toHaveProperty('image');
    expect(getFrameCapabilityViolation(
      'seedance-2.5',
      'first-last',
      { ...reference('legacy-frame', 'image', 'https://cdn.example.com/frame'), width: undefined, height: undefined },
    )).toContain('首帧尺寸信息不完整');
    expect(getFrameCapabilityViolation(
      'seedance-2.5',
      'first-last',
      { ...reference('ready-frame', 'image', 'https://cdn.example.com/frame'), width: 1200, height: 800 },
    )).toBeNull();
  });

  it('失败任务详情会保留首帧宽高，切换或重试 2.5 时可在浏览器内校验', () => {
    const job = {
      id: 'job-frame-size', kind: 'video', model: 'Seedance 2.5', prompt: '首尾帧', duration: '30s',
      configData: {
        mode: 'first-last', aspectRatio: 'adaptive', resolution: '720p', durationSeconds: 30,
        referenceAssets: [{
          id: 'frame-sized', name: '首帧.png', type: 'image', role: 'first_frame',
          previewUrl: 'https://signed.example.com/frame.png', width: 1200, height: 800,
        }],
      },
    } as unknown as AdminGenerationJob;
    expect(buildGenerationDraftFromJob(job, [])?.referenceAssets?.[0]).toMatchObject({
      id: 'frame-sized', width: 1200, height: 800,
    });
  });

  it('余额不足提供独立充值入口，且四个模型提供明确营销短句', () => {
    const studio = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');
    const controls = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudioVideoControls.tsx'), 'utf8');
    expect(studio).toContain('多模态长视频，原生有声更沉浸');
    expect(studio).toContain('1080p 高清输出，正式成片首选');
    expect(studio).toContain('更快生成，适合高效试稿');
    expect(studio).toContain('低成本批量创作，日常出片更省');
    expect(controls).toContain('充值 / 查看套餐');
    expect(controls).toContain('onCreditsRecharge');
    expect(controls).toContain('当前未开放或积分配置未完整');
  });

  it('提交前重新校验最新模型能力和当前标量参数', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/AIStudio.tsx'), 'utf8');
    expect(source).toContain('const latestConfiguration = reconcileVideoConfiguration(latestCapability');
    expect(source).toContain('!latestCapability.available || !latestCombinationAvailable || latestConfiguration.adjusted.length > 0');
    expect(source).toContain('模型能力配置已更新');
  });
});
