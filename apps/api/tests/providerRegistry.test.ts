import { describe, expect, it } from 'vitest';
import {
  isFakeProviderEnabled,
  selectGenerationProviderName,
  supportsArkSeedanceProvider,
  supportsArkSeedreamProvider,
} from '../src/providers/providerRegistry.js';
import type { ProviderTaskInput } from '../src/providers/fakeProvider.js';

const baseInput: ProviderTaskInput = {
  taskId: 'task-1',
  userId: 'user-1',
  kind: 'video',
  model: 'Seedance 2.0',
  prompt: '测试视频',
  credits: 40,
  config: {},
};

describe('providerRegistry', () => {
  it('Seedance 普通版、Fast 和 Mini 都走 volcengine-ark provider', () => {
    expect(supportsArkSeedanceProvider({ ...baseInput, model: 'Seedance 2.0' })).toBe(true);
    expect(supportsArkSeedanceProvider({ ...baseInput, model: 'Seedance 2.0 Fast' })).toBe(true);
    expect(supportsArkSeedanceProvider({ ...baseInput, model: 'Seedance 2.0 Mini' })).toBe(true);
  });

  it('非 Seedance 2.0 系列不走方舟 Seedance provider', () => {
    expect(supportsArkSeedanceProvider({ ...baseInput, model: 'GPT Image 2.0' })).toBe(false);
    expect(supportsArkSeedanceProvider({ ...baseInput, kind: 'image', model: 'Seedance 2.0' })).toBe(false);
  });

  it('只有严格的 Seedream 5.0 Pro 图片任务走方舟 Seedream provider', () => {
    expect(supportsArkSeedreamProvider({
      ...baseInput, kind: 'image', model: 'Seedream 5.0 Pro',
    })).toBe(true);
    expect(supportsArkSeedreamProvider({
      ...baseInput, kind: 'image', model: 'Seedream 5.0 pro',
    })).toBe(false);
    expect(supportsArkSeedreamProvider({
      ...baseInput, kind: 'video', model: 'Seedream 5.0 Pro',
    })).toBe(false);
    expect(selectGenerationProviderName({
      ...baseInput, kind: 'image', model: 'Seedream 5.0 Pro',
    }, {
      arkApiKey: 'configured', nodeEnv: 'test', fakeProviderEnabled: true,
    })).toBe('volcengine-ark');
  });

  it('Fake Provider 只允许在开发或测试环境显式开启', () => {
    expect(isFakeProviderEnabled('development', false)).toBe(false);
    expect(isFakeProviderEnabled('test', true)).toBe(true);
    expect(isFakeProviderEnabled('development', true)).toBe(true);
    expect(isFakeProviderEnabled('production', true)).toBe(false);
  });

  it('在 run 创建前固定实际 provider，Fake fallback 不先写成方舟', () => {
    expect(selectGenerationProviderName(baseInput, {
      nodeEnv: 'test',
      fakeProviderEnabled: true,
    })).toBe('fake-provider');
    expect(selectGenerationProviderName(baseInput, {
      arkApiKey: 'configured',
      nodeEnv: 'test',
      fakeProviderEnabled: true,
    })).toBe('volcengine-ark');
    expect(selectGenerationProviderName({
      ...baseInput,
      providerTaskId: 'fake-task-1',
    }, {
      arkApiKey: 'configured',
    })).toBe('fake-provider');
  });
});
