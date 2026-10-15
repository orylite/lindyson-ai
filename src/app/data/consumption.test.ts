import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_MODEL_CAPABILITIES,
  getAvailableVideoConsumptionCombinations,
  getImageConsumptionCredits,
  getVideoModelCapability,
  getVideoConsumptionCredits,
  getVideoConsumptionParameterOptions,
  isPromptWizardV6Available,
  isTkPromptEngineAvailable,
  type ConsumptionSettings,
} from './consumption';

describe('视频积分消耗配置', () => {
  it('只按后端配置返回视频积分，并跳过暂不开放配置', () => {
    const settings: ConsumptionSettings = {
      video: [
        {
          id: 'db-video-setting-1',
          model: 'seedance-2.0',
          modelLabel: 'Seedance 2.0',
          duration: '15',
          resolution: '720p',
          credits: 88,
          referenceVideoCredits: 54,
          available: true,
        },
        {
          id: 'db-video-setting-2',
          model: 'seedance-2.0-fast',
          modelLabel: 'Seedance 2.0 Fast',
          duration: '15',
          resolution: '1080p',
          credits: 72,
          referenceVideoCredits: 48,
          available: false,
        },
      ],
      image: [
        {
          id: 'seedream-image-1k',
          model: 'seedream-5.0-pro',
          modelLabel: 'Seedream 5.0 Pro',
          resolution: '1K',
          credits: 14,
          available: true,
        },
        {
          id: 'seedream-image-2k',
          model: 'seedream-5.0-pro',
          modelLabel: 'Seedream 5.0 Pro',
          resolution: '2K',
          credits: 28,
          available: false,
        },
      ],
      promptWizard: {
        generationCredits: 1,
        available: true,
        engineVersion: 4,
        updatedAt: '2026-07-17T00:00:00.000Z',
      },
    };

    expect(getVideoConsumptionCredits(settings, 'seedance-2.0', '15', '720p')).toBe(88);
    expect(getVideoConsumptionCredits(settings, 'seedance-2.0', '15', '720p', true)).toBe(54);
    expect(getVideoConsumptionCredits(settings, 'seedance-2.0-fast', '15', '1080p')).toBe(0);
    expect(getVideoConsumptionCredits(settings, 'seedance-2.0-fast', '15', '1080p', true)).toBe(0);
    expect(getImageConsumptionCredits(settings, '1K')).toBe(14);
    expect(getImageConsumptionCredits(settings, '2K')).toBe(0);
  });

  it('只有 engine 4 且已开放时才允许进入 V6 提示词向导', () => {
    const base = {
      generationCredits: 1,
      available: true,
      updatedAt: '2026-08-08T00:00:00.000Z',
    } as const;

    expect(isPromptWizardV6Available({ ...base, engineVersion: 4 })).toBe(true);
    expect(isPromptWizardV6Available({ ...base, engineVersion: 3 })).toBe(false);
    expect(isPromptWizardV6Available({ ...base, engineVersion: 4, available: false })).toBe(false);
  });

  it('TK Prompt Engine 只读取独立 schemaVersion 1 开关，不回退到V6', () => {
    expect(isTkPromptEngineAvailable({
      schemaVersion: 1,
      generationCredits: 2,
      available: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    })).toBe(true);
    expect(isTkPromptEngineAvailable({
      schemaVersion: 1,
      generationCredits: 2,
      available: false,
      updatedAt: '2026-08-17T00:00:00.000Z',
    })).toBe(false);
    expect(isTkPromptEngineAvailable(undefined)).toBe(false);
  });

  it('Seedance 2.5 在旧接口完全缺少能力元数据时按旧 10 档保持可用', () => {
    const settings: ConsumptionSettings = {
      video: (['480p', '720p'] as const).flatMap(resolution => (
        ([5, 10, 15, 20, 30] as const).map(duration => ({
          id: `seedance-25-${duration}-${resolution}`,
          model: 'seedance-2.5' as const,
          modelLabel: 'Seedance 2.5',
          duration: String(duration) as '5' | '10' | '15' | '20' | '30',
          resolution,
          credits: 180,
          referenceVideoCredits: 200,
          available: true,
        }))
      )),
      image: [],
      promptWizard: { generationCredits: 1, available: true, engineVersion: 4, updatedAt: '' },
    };

    expect(getVideoModelCapability(settings, 'seedance-2.5')).toMatchObject({
      available: true,
      durationSeconds: [5, 10, 15, 20, 30],
      resolutions: ['480p', '720p'],
      references: { maxTotal: 50, maxImages: 30, maxVideos: 10, maxAudios: 10, allowAudioOnly: true },
      supportsPromptWizard: false,
      supportsRealPortrait: false,
    });
    expect(getVideoConsumptionCredits(settings, 'seedance-2.5', '30', '720p')).toBe(180);
    expect(DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.5'].aspectRatios.firstLast).toEqual(['adaptive']);
  });

  it('旧接口缺少能力元数据时，2.5 的缺档、零价或部分暂停仍保持不可用', () => {
    const completeRows = (['480p', '720p'] as const).flatMap(resolution => (
      ([5, 10, 15, 20, 30] as const).map(duration => ({
        id: `legacy-${resolution}-${duration}`,
        model: 'seedance-2.5' as const,
        modelLabel: 'Seedance 2.5',
        duration: String(duration) as '5' | '10' | '15' | '20' | '30',
        resolution,
        credits: 10,
        referenceVideoCredits: 6,
        available: true,
      }))
    ));
    const base = {
      image: [],
      promptWizard: { generationCredits: 1, available: false, engineVersion: 4 as const, updatedAt: '' },
    };

    expect(getVideoModelCapability({ ...base, video: completeRows.slice(0, 9) }, 'seedance-2.5').available)
      .toBe(false);
    expect(getVideoModelCapability({
      ...base,
      video: completeRows.map((row, index) => index === 0 ? { ...row, credits: 0 } : row),
    }, 'seedance-2.5').available).toBe(false);
    expect(getVideoModelCapability({
      ...base,
      video: completeRows.map((row, index) => index === 0 ? { ...row, available: false } : row),
    }, 'seedance-2.5').available).toBe(false);
  });

  it('优先采用后端模型能力元数据但仍要求存在开放积分档', () => {
    const settings: ConsumptionSettings = {
      video: [],
      videoModels: [{
        ...DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.5'],
        available: true,
        durationSeconds: [5, 10],
      }],
      image: [],
      promptWizard: { generationCredits: 1, available: true, engineVersion: 4, updatedAt: '' },
    };

    expect(getVideoModelCapability(settings, 'seedance-2.5')).toMatchObject({
      available: false,
      durationSeconds: [5, 10],
    });
  });

  it('旧接口的零价档不会让模型误显示为可选', () => {
    const settings: ConsumptionSettings = {
      video: [{
        id: 'zero-price', model: 'seedance-2.5', modelLabel: 'Seedance 2.5', duration: '5', resolution: '480p',
        credits: 0, referenceVideoCredits: 0, available: true,
      }],
      image: [],
      promptWizard: { generationCredits: 1, available: true, engineVersion: 4, updatedAt: '' },
    };
    expect(getVideoModelCapability(settings, 'seedance-2.5').available).toBe(false);
  });

  it('2.5 必须按能力表补齐 12 个分辨率时长组合且普通/参考视频双档均为正价', () => {
    const completeRows = (['480p', '720p'] as const).flatMap(resolution => (
      ([5, 10, 15, 20, 25, 30] as const).map(duration => ({
        id: `${resolution}-${duration}`,
        model: 'seedance-2.5' as const,
        modelLabel: 'Seedance 2.5',
        duration: String(duration) as '5' | '10' | '15' | '20' | '25' | '30',
        resolution,
        credits: 10,
        referenceVideoCredits: 12,
        available: true,
      }))
    ));
    const base = {
      image: [],
      videoModels: [{ ...DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.5'], available: true }],
      promptWizard: { generationCredits: 1, available: true, engineVersion: 4 as const, updatedAt: '' },
    };
    expect(getVideoModelCapability({ ...base, video: completeRows }, 'seedance-2.5').available).toBe(true);
    expect(getVideoModelCapability({ ...base, video: completeRows.slice(0, 11) }, 'seedance-2.5').available).toBe(false);
    expect(getVideoModelCapability({
      ...base,
      video: [
        ...completeRows,
        { ...completeRows[0]!, id: 'extra-1080p', resolution: '1080p' },
      ],
    }, 'seedance-2.5').available).toBe(false);
    expect(getVideoModelCapability({
      ...base,
      video: completeRows.map((row, index) => index === 4 ? { ...row, referenceVideoCredits: 0 } : row),
    }, 'seedance-2.5').available).toBe(false);
    const capability = getVideoModelCapability({ ...base, video: completeRows }, 'seedance-2.5');
    const combinations = getAvailableVideoConsumptionCombinations(
      { ...base, video: completeRows },
      'seedance-2.5',
      capability,
    );
    expect(getVideoConsumptionParameterOptions(capability, combinations, '480p').durationSeconds)
      .toEqual([5, 10, 15, 20, 25, 30]);
    expect(getVideoConsumptionCredits({ ...base, video: completeRows }, 'seedance-2.5', '25', '480p')).toBe(10);
  });

  it('本地默认能力含 25 秒时，仍兼容只返回旧 10 档的远端能力与价格', () => {
    const legacyCapability = {
      ...DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.5'],
      available: true,
      durationSeconds: [5, 10, 15, 20, 30] as Array<5 | 10 | 15 | 20 | 30>,
    };
    const legacyRows = (['480p', '720p'] as const).flatMap(resolution => (
      legacyCapability.durationSeconds.map(duration => ({
        id: `legacy-${resolution}-${duration}`,
        model: 'seedance-2.5' as const,
        modelLabel: 'Seedance 2.5',
        duration: String(duration) as '5' | '10' | '15' | '20' | '30',
        resolution,
        credits: 10,
        referenceVideoCredits: 6,
        available: true,
      }))
    ));
    const settings: ConsumptionSettings = {
      video: legacyRows,
      videoModels: [legacyCapability],
      image: [],
      promptWizard: { generationCredits: 1, available: false, engineVersion: 4, updatedAt: '' },
    };

    const capability = getVideoModelCapability(settings, 'seedance-2.5');
    expect(capability.available).toBe(true);
    expect(capability.durationSeconds).toEqual([5, 10, 15, 20, 30]);
    expect(getAvailableVideoConsumptionCombinations(settings, 'seedance-2.5', capability)).toHaveLength(10);
  });

  it('25 秒不会被加入 Seedance 2.0 的参数菜单', () => {
    expect(DEFAULT_VIDEO_MODEL_CAPABILITIES['seedance-2.0'].durationSeconds).toEqual([5, 10, 15]);
  });

  it('参数选项只展示能力表与开放正价组合的交集，并按当前分辨率约束时长', () => {
    const settings: ConsumptionSettings = {
      video: [
        {
          id: 'valid-480p-5', model: 'seedance-2.0', modelLabel: 'Seedance 2.0',
          duration: '5', resolution: '480p', credits: 10, referenceVideoCredits: 6, available: true,
        },
        {
          id: 'valid-720p-15', model: 'seedance-2.0', modelLabel: 'Seedance 2.0',
          duration: '15', resolution: '720p', credits: 20, referenceVideoCredits: 12, available: true,
        },
        {
          id: 'zero-720p-10', model: 'seedance-2.0', modelLabel: 'Seedance 2.0',
          duration: '10', resolution: '720p', credits: 0, referenceVideoCredits: 0, available: true,
        },
        {
          id: 'outside-capability', model: 'seedance-2.0-fast', modelLabel: 'Seedance 2.0 Fast',
          duration: '15', resolution: '1080p', credits: 10, referenceVideoCredits: 6, available: true,
        },
      ],
      image: [],
      promptWizard: { generationCredits: 1, available: true, engineVersion: 4, updatedAt: '' },
    };
    const capability = getVideoModelCapability(settings, 'seedance-2.0');
    const combinations = getAvailableVideoConsumptionCombinations(settings, 'seedance-2.0', capability);

    expect(combinations.map(item => item.id)).toEqual(['valid-480p-5', 'valid-720p-15']);
    expect(getVideoConsumptionParameterOptions(capability, combinations, '720p')).toEqual({
      resolutions: ['480p', '720p'],
      durationSeconds: [15],
    });
    expect(getVideoModelCapability(settings, 'seedance-2.0-fast').available).toBe(false);
  });
});
