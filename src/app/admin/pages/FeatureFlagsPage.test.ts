import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import { AdminFeatureFlagsPage } from './FeatureFlagsPage';

describe('管理端TK Prompt Engine 1.0独立开关', () => {
  it('展示schemaVersion 1和三卡新任务边界', () => {
    const markup = renderToStaticMarkup(createElement(AdminFeatureFlagsPage, {
      featureFlags: { tiktokAccounts: true, tiktokPublish: true },
      tkPromptEngine: {
        schemaVersion: 1,
        generationCredits: 1,
        available: true,
        updatedAt: '2026-08-17T00:00:00.000Z',
      },
      onFeatureFlagsChange: vi.fn().mockResolvedValue(undefined),
      onTkPromptEngineSettingsChange: vi.fn().mockResolvedValue(undefined),
      setConfirm: vi.fn(),
    }));

    expect(markup).toContain('TK Prompt Engine 1.0');
    expect(markup).toContain('当前固定 schemaVersion 1');
    expect(markup).toContain('safe/native/creative三个方案');
    expect(markup).not.toContain('当前固定为 V6 三方向引擎');
    expect(markup).toMatch(/data-state="on"[^>]*aria-checked="true"[^>]*aria-label="开放 TK Prompt Engine 1\.0"/u);
  });

  it('新设置未加载时不回退使用V6开关', () => {
    const markup = renderToStaticMarkup(createElement(AdminFeatureFlagsPage, {
      featureFlags: { tiktokAccounts: true, tiktokPublish: true },
      tkPromptEngine: undefined,
      onFeatureFlagsChange: vi.fn().mockResolvedValue(undefined),
      onTkPromptEngineSettingsChange: vi.fn().mockResolvedValue(undefined),
      setConfirm: vi.fn(),
    }));

    expect(markup).toContain('加载中');
    expect(markup).toContain('TK Prompt Engine 1.0设置未就绪');
    expect(markup).toMatch(/aria-label="开放 TK Prompt Engine 1\.0"[^>]*disabled=""/u);
  });

  it('设置就绪但尚未开放时禁用管理端开启并说明受审计切流边界', () => {
    const markup = renderToStaticMarkup(createElement(AdminFeatureFlagsPage, {
      featureFlags: { tiktokAccounts: true, tiktokPublish: true },
      tkPromptEngine: {
        schemaVersion: 1,
        generationCredits: 1,
        available: false,
        updatedAt: '2026-08-17T00:00:00.000Z',
      },
      onFeatureFlagsChange: vi.fn().mockResolvedValue(undefined),
      onTkPromptEngineSettingsChange: vi.fn().mockResolvedValue(undefined),
      setConfirm: vi.fn(),
    }));

    expect(markup).toContain('管理页面不能绕过发布门禁');
    expect(markup).toMatch(/aria-label="开放 TK Prompt Engine 1\.0"[^>]*disabled=""/u);
  });
});
