import type {
  TkPromptEvidenceProfile,
  TkPromptGeneration,
  TkPromptOption,
  TkPromptPlanSlot,
  TkPromptRun,
  TkPromptVideoConfig,
} from '@lindyson/api-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { createTkPromptGeneration, createTkPromptRun } from '../api/mutations';
import { IdempotencyKeyRegistry } from '../api/idempotency';
import type { ConsumptionSettings } from '../data/consumption';
import {
  buildEmptyTkPromptProductState,
  buildTkPromptCreativeInput,
  buildTkPromptGenerationRestoreSnapshot,
  buildTkPromptSource,
  createTkPromptGenerationIdempotently,
  createTkPromptRunIdempotently,
  formatTkPromptFailureReason,
  getTkPromptGenerationResumeDisposition,
  getPromptEditBucket,
  getTkPromptAudioMode,
  isTkPromptGenerationComplete,
  PromptWizard,
  resolveTkPromptGenerationSnapshots,
  sortTkPromptOptions,
  stripTkPromptTimePrefix,
  TK_PROMPT_LANGUAGES,
  TK_PROMPT_MARKET_OPTIONS,
  tkPromptDisplayLabel,
  tkPromptVideoConfigEquals,
} from './PromptWizard';

describe('黄金三秒展示', () => {
  it.each(['1-3秒', '1–3秒：', '1到3秒内', ' 1 至 3 秒: '])('移除重复时间前缀 %s', prefix => {
    expect(stripTkPromptTimePrefix(`${prefix}点明受众需求`, '1-3')).toBe('点明受众需求');
  });
  it('只处理开头对应的时间段，保留正文和其他时间', () => {
    expect(stripTkPromptTimePrefix('0–1秒：展示商品', '0-1')).toBe('展示商品');
    expect(stripTkPromptTimePrefix('展示1-3秒操作过程', '1-3')).toBe('展示1-3秒操作过程');
    expect(stripTkPromptTimePrefix('3-7秒展示商品', '1-3')).toBe('3-7秒展示商品');
    expect(stripTkPromptTimePrefix(undefined, '1-3')).toBe('');
  });
});

const videoConfig: TkPromptVideoConfig = {
  model: 'seedance-2.0',
  aspectRatio: '9:16',
  resolution: '720p',
  durationSeconds: 15,
};

function option(slot: TkPromptPlanSlot, status: TkPromptOption['status'] = 'completed') {
  return {
    id: `00000000-0000-4000-8000-0000000000${slot === 'safe' ? '11' : slot === 'native' ? '12' : '13'}`,
    generationId: '00000000-0000-4000-8000-000000000010',
    slot,
    status,
    plan: status === 'completed' ? { title: slot } : null,
  } as unknown as TkPromptOption;
}

function generation(options: TkPromptOption[], status: TkPromptGeneration['status'] = 'completed') {
  return { status, options } as unknown as TkPromptGeneration;
}

const consumptionSettings: ConsumptionSettings = {
  video: [{
    id: 'seedance-2.0-15-720p',
    model: 'seedance-2.0',
    modelLabel: 'Seedance 2.0',
    duration: '15',
    resolution: '720p',
    credits: 70,
    referenceVideoCredits: 70,
    available: true,
  }],
  image: [],
  promptWizard: {
    generationCredits: 2,
    available: true,
    engineVersion: 4,
    updatedAt: '2026-08-17T00:00:00.000Z',
  },
  tkPromptEngine: {
    schemaVersion: 1,
    generationCredits: 2,
    available: true,
    updatedAt: '2026-08-17T00:00:00.000Z',
  },
};

describe('TK Prompt Engine 1.0 前端协议规则', () => {
  it('新商品事实域从空白人工确认开始，画面方式回到自动模式', () => {
    const first = buildEmptyTkPromptProductState();
    const second = buildEmptyTkPromptProductState();

    expect(first).toEqual({
      productName: '',
      category: '',
      acceptedFactIds: new Set(),
      userFacts: '',
      forbiddenClaims: '',
      targetAudience: '',
      verifiedOffer: '',
      appearance: { mode: 'auto' },
      selectedSlot: 'safe',
    });
    expect(second.acceptedFactIds).not.toBe(first.acceptedFactIds);
  });

  it('固定提供14种且不重复的口播语言', () => {
    expect(TK_PROMPT_LANGUAGES).toHaveLength(14);
    expect(new Set(TK_PROMPT_LANGUAGES)).toHaveProperty('size', 14);
    expect(TK_PROMPT_LANGUAGES).toEqual([
      '英语', '西班牙语', '葡萄牙语', '法语', '印尼语', '意大利语', '日语',
      '马来语', '泰语', '越南语', '普通话', '德语', '荷兰语', '波兰语',
    ]);
  });

  it.each(TK_PROMPT_LANGUAGES)('10/15秒逐项原样发送%s作为口播语言', language => {
    const input = buildTkPromptCreativeInput({
      durationSeconds: 15,
      targetMarket: '美国',
      targetAudience: '',
      spokenLanguage: language,
      verifiedOffer: '',
      appearance: { mode: 'auto' },
      availableScenes: [],
      availableAssets: [],
    });

    expect(input).not.toHaveProperty('publishLanguage');
    expect(input.spokenLanguage).toBe(language);
  });

  it('墨西哥市场存在且与西班牙语口播独立组合', () => {
    expect(TK_PROMPT_MARKET_OPTIONS).toContainEqual(['墨西哥', '墨西哥']);
    const input = buildTkPromptCreativeInput({
      durationSeconds: 15,
      targetMarket: '墨西哥',
      targetAudience: '',
      spokenLanguage: '西班牙语',
      verifiedOffer: '',
      appearance: { mode: 'auto' },
      availableScenes: [],
      availableAssets: [],
    });
    expect(input).toEqual(expect.objectContaining({
      targetMarket: '墨西哥',
      spokenLanguage: '西班牙语',
    }));
  });

  it('市场名称仅含中文且中国大陆位于最后', () => {
    expect(TK_PROMPT_MARKET_OPTIONS.every(([value, label]) => value === label && !/[A-Za-z（）]/u.test(label))).toBe(true);
    expect(TK_PROMPT_MARKET_OPTIONS[TK_PROMPT_MARKET_OPTIONS.length - 1]).toEqual(['中国大陆', '中国大陆']);
  });

  it('内部英文枚举统一显示为中文', () => {
    expect(tkPromptDisplayLabel('product_pov')).toBe('商品视角');
    expect(tkPromptDisplayLabel('scene_demo')).toBe('真实场景演示');
    expect(tkPromptDisplayLabel('sound_hook')).toBe('声音触发');
    expect(tkPromptDisplayLabel('未知合法名称')).toBe('未知合法名称');
  });

  it('Provider内部错误转换为可操作中文且不暴露英文堆栈', () => {
    expect(formatTkPromptFailureReason('TK_PROMPT_PROVIDER_DNS_UNAVAILABLE: EAI_AGAIN', '失败'))
      .toBe('提示词服务网络暂时不稳定，请稍后重新生成。');
    expect(formatTkPromptFailureReason('TypeError: fetch failed', '生成失败，请重试'))
      .toBe('提示词服务网络暂时不稳定，请稍后重新生成。');
    expect(formatTkPromptFailureReason('TK_PROMPT_PROVIDER_INVALID_JSON: bad payload', '失败'))
      .toBe('提示词服务返回格式异常，请重新生成。');
    expect(formatTkPromptFailureReason('unexpected provider failure', '生成失败，请重试'))
      .toBe('生成失败，请重试');
  });

  it('5秒不发送语言字段与优惠', () => {
    expect(getTkPromptAudioMode(5)).toBe('sound-design-only');
    expect(getTkPromptAudioMode(10)).toBe('voiceover');
    expect(getTkPromptAudioMode(15)).toBe('voiceover');

    const input = buildTkPromptCreativeInput({
      durationSeconds: 5,
      targetMarket: ' 美国 ',
      targetAudience: ' 养宠人群 ',
      spokenLanguage: '英语',
      verifiedOffer: ' 满30减5 ',
      appearance: { mode: 'scene_demo' },
      availableScenes: [' 厨房 ', '厨房', ''],
      availableAssets: [' 商品图片 ', '商品图片'],
    });

    expect(input).toEqual({
      targetMarket: '美国',
      targetAudience: '养宠人群',
      verifiedOffer: '',
      appearance: { mode: 'scene_demo' },
      availableScenes: ['厨房'],
      availableAssets: ['商品图片'],
    });
    expect(input).not.toHaveProperty('spokenLanguage');
  });

  it('10/15秒口播语言独立于市场，人物出镜不发送演员素材', () => {
    const input = buildTkPromptCreativeInput({
      durationSeconds: 10,
      targetMarket: '日本',
      targetAudience: '',
      spokenLanguage: '英语',
      verifiedOffer: ' 满49包邮 ',
      appearance: { mode: 'live_presenter' },
      availableScenes: [],
      availableAssets: [],
    });

    expect(input).not.toHaveProperty('publishLanguage');
    expect(input.spokenLanguage).toBe('英语');
    expect(input.verifiedOffer).toBe('满49包邮');
    expect(input.appearance).toEqual({ mode: 'live_presenter' });
    expect(input.appearance).not.toHaveProperty('authorizedActorAssetId');
  });

  it('完成门禁只接受safe/native/creative各一套完整方案并按固定顺序展示', () => {
    const unsorted = [option('creative'), option('safe'), option('native')];
    expect(isTkPromptGenerationComplete(generation(unsorted))).toBe(true);
    expect(sortTkPromptOptions(unsorted).map(item => item.slot)).toEqual(['safe', 'native', 'creative']);
    expect(isTkPromptGenerationComplete(generation(unsorted.slice(0, 2)))).toBe(false);
    expect(isTkPromptGenerationComplete(generation([
      option('safe'), option('native'), option('creative', 'processing'),
    ]))).toBe(false);
    expect(isTkPromptGenerationComplete(generation(unsorted, 'expanding'))).toBe(false);
  });

  it('同图只恢复在途任务，已完成与失败任务只作为历史来源', () => {
    expect(getTkPromptGenerationResumeDisposition(generation([], 'queued'))).toBe('active');
    expect(getTkPromptGenerationResumeDisposition(generation([], 'strategizing'))).toBe('active');
    expect(getTkPromptGenerationResumeDisposition(generation([], 'failed'))).toBe('failed-history');
    expect(getTkPromptGenerationResumeDisposition(generation([
      option('safe'), option('native'), option('creative'),
    ]))).toBe('completed-history');
    expect(getTkPromptGenerationResumeDisposition(null)).toBe('none');
  });

  it('应用来源只携带独立TK协议字段', () => {
    expect(buildTkPromptSource(
      '00000000-0000-4000-8000-000000000031',
      '00000000-0000-4000-8000-000000000032',
      '00000000-0000-4000-8000-000000000033',
    )).toEqual({
      runId: '00000000-0000-4000-8000-000000000031',
      generationId: '00000000-0000-4000-8000-000000000032',
      optionId: '00000000-0000-4000-8000-000000000033',
      schemaVersion: 1,
      editBucket: 'none',
    });
  });

  it('事实分析响应丢失后的显式重试复用同一幂等键', async () => {
    const registry = new IdempotencyKeyRegistry();
    const imageAssetIds = ['00000000-0000-4000-8000-000000000041'];
    const observedKeys: string[] = [];
    let responseLost = true;
    const persistedRun = {
      id: '00000000-0000-4000-8000-000000000042',
      schemaVersion: 1,
      status: 'analyzing',
      imageAssetIds,
      evidenceProfile: null,
      failureReason: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      completedAt: null,
    } as TkPromptRun;
    const execute: typeof createTkPromptRun = vi.fn(async (payload) => {
      observedKeys.push(payload.idempotencyKey);
      if (responseLost) {
        responseLost = false;
        throw new TypeError('response lost after commit');
      }
      return persistedRun;
    });

    await expect(createTkPromptRunIdempotently(registry, imageAssetIds, execute))
      .rejects.toThrow('response lost after commit');
    await expect(createTkPromptRunIdempotently(registry, imageAssetIds, execute))
      .resolves.toBe(persistedRun);
    expect(observedKeys).toHaveLength(2);
    expect(observedKeys[1]).toBe(observedKeys[0]);
  });

  it('三案响应不确定时同intent重放，成功后的下一次换整批使用新键', async () => {
    const registry = new IdempotencyKeyRegistry();
    const runId = '00000000-0000-4000-8000-000000000051';
    const firstSourceGenerationId = '00000000-0000-4000-8000-000000000052';
    const nextSourceGenerationId = '00000000-0000-4000-8000-000000000053';
    const observedKeys: string[] = [];
    let responseLost = true;
    const execute: typeof createTkPromptGeneration = async (_runId, payload) => {
      observedKeys.push(payload.idempotencyKey);
      if (responseLost) {
        responseLost = false;
        throw new TypeError('generation response lost after commit');
      }
      return { id: nextSourceGenerationId } as TkPromptGeneration;
    };
    const payload = {
      expectedGenerationCredits: 2,
      evidenceReview: {},
      creativeInput: {},
      videoConfig: {},
    } as Omit<Parameters<typeof createTkPromptGeneration>[1], 'idempotencyKey'>;

    const firstIntent = {
      registry,
      runId,
      intent: 'refresh' as const,
      sourceGenerationId: firstSourceGenerationId,
      payload,
      execute,
    };
    await expect(createTkPromptGenerationIdempotently(firstIntent))
      .rejects.toThrow('generation response lost after commit');
    await expect(createTkPromptGenerationIdempotently(firstIntent))
      .resolves.toMatchObject({ id: nextSourceGenerationId });
    expect(observedKeys[1]).toBe(observedKeys[0]);

    await expect(createTkPromptGenerationIdempotently({
      ...firstIntent,
      sourceGenerationId: nextSourceGenerationId,
    })).resolves.toMatchObject({ id: nextSourceGenerationId });
    expect(observedKeys[2]).not.toBe(observedKeys[1]);
  });

  it('视频参数变化与提示词修改幅度正确归因', () => {
    expect(tkPromptVideoConfigEquals(videoConfig, { ...videoConfig })).toBe(true);
    expect(tkPromptVideoConfigEquals(videoConfig, { ...videoConfig, durationSeconds: 10 })).toBe(false);
    expect(getPromptEditBucket('完整提示词', '完整提示词')).toBe('none');
    expect(getPromptEditBucket('这是一个比较长的完整提示词文本', '这是一个比较长的完整提示词文本。')).toBe('minor');
    expect(getPromptEditBucket('原始方案', '完全不同的新方案内容')).toBe('material');
  });

  it('恢复已完成批次时使用生成当时的事实、创作与视频快照', () => {
    const persistedConfig: TkPromptVideoConfig = {
      model: 'seedance-2.0-mini',
      aspectRatio: '9:16',
      resolution: '480p',
      durationSeconds: 10,
    };
    const persistedGeneration = {
      evidenceReview: {
        productName: '历史确认商品',
        category: '宠物用品',
        rejectedVisibleFactIds: ['visible-002'],
        userConfirmedFacts: [{ factId: 'confirmed-001', text: '用户确认容量 2L' }],
        forbiddenClaims: ['不得宣称医疗功效'],
      },
      creativeInput: {
        targetMarket: '日本',
        targetAudience: '养猫用户',
        spokenLanguage: '英语',
        verifiedOffer: '满49包邮',
        appearance: { mode: 'scene_demo' },
        availableScenes: [],
        availableAssets: ['商品参考图片1'],
      },
      videoConfig: persistedConfig,
    } as unknown as TkPromptGeneration;
    const persistedProfile = {
      visibleFacts: [
        { factId: 'visible-001', text: '白色主体' },
        { factId: 'visible-002', text: '待拒绝事实' },
      ],
    } as unknown as TkPromptEvidenceProfile;

    expect(buildTkPromptGenerationRestoreSnapshot(
      persistedGeneration,
      persistedProfile,
    )).toEqual(expect.objectContaining({
      productName: '历史确认商品',
      acceptedFactIds: ['visible-001'],
      userFacts: '用户确认容量 2L',
      targetMarket: '日本',
      spokenLanguage: '英语',
      videoConfig: persistedConfig,
    }));
    const currentEvidenceReview = {
      ...persistedGeneration.evidenceReview,
      productName: '当前确认商品',
    };
    const currentCreativeInput = {
      ...persistedGeneration.creativeInput,
      targetMarket: '墨西哥',
      spokenLanguage: '西班牙语' as const,
    };
    expect(resolveTkPromptGenerationSnapshots({
      intent: 'refresh',
      generation: persistedGeneration,
      evidenceReview: currentEvidenceReview,
      creativeInput: currentCreativeInput,
      videoConfig,
    })).toEqual({
      evidenceReview: currentEvidenceReview,
      creativeInput: currentCreativeInput,
      videoConfig,
    });
  });
});

describe('TK Prompt Engine 1.0 界面边界', () => {
  it('人物出镜交给Seedance生成成年虚构非名人且不读取真人演员库', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/components/PromptWizard.tsx'), 'utf8');

    expect(source).toContain("['live_presenter', '人物出镜'");
    expect(source).toContain('Seedance会按目标市场与口播语言生成成年虚构非名人');
    expect(source).toContain('单条视频中保持人物身份一致');
    expect(source).toContain('5秒方案可以出镜，但全程无对白、口播或其他人声');
    expect(source).not.toMatch(/authorizedActorAssetId|realPortraitActors|realPortraitAssetId|onRealPortraitLibraryOpen/u);
  });

  it('展示新版三步和独立来源，不回退为V6流程', () => {
    const markup = renderToStaticMarkup(createElement(PromptWizard, {
      images: [],
      initialConfig: videoConfig,
      hasReferenceVideo: false,
      consumptionSettings,
      availableCredits: 100,
      onPickImages: vi.fn(),
      onRemoveImage: vi.fn(),
      onConsumptionSettingsRefresh: vi.fn().mockResolvedValue(consumptionSettings),
      onCreditsChanged: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
      onApply: vi.fn(),
    }));

    expect(markup).toContain('TK Prompt Engine 1.0');
    expect(markup).toContain('确认商品事实');
    expect(markup).toContain('设置市场与创作条件');
    expect(markup).toContain('三个提示词方案');
    expect(markup).toContain('请先选择1–9张商品图片');
    expect(markup).not.toContain('V6');
    expect(markup).not.toContain('快节奏商品图混剪');
    expect(markup).not.toContain('授权演员');
    expect(markup.match(/aria-label="关闭提示词向导"/gu)).toHaveLength(1);
  });
});
