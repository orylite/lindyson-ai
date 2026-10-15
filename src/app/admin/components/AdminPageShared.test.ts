import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ExactCursorPagination } from '../../api/cursor';
import { AdminDataTable, buildDefaultPlan, validatePlanEditForm } from './AdminPageShared';

describe('后台表格轻量分页', () => {
  const items = [
    { id: 'row-1', name: '第一条' },
    { id: 'row-2', name: '第二条' },
    { id: 'row-3', name: '第三条' },
  ];

  it('本地分页显示本页与总数，并使用四个纯图标按钮和精准页码', () => {
    const markup = renderTable({ items, pageSize: 2 });

    expect(markup).toContain('本页 2 条 · 共 3 条');
    expect(markup).toContain('aria-label="分页导航"');
    expect(markup).toContain('aria-label="第 1 页，共 2 页"');
    for (const label of ['首页', '上一页', '下一页', '尾页']) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    expect(markup.match(/<button[^>]+disabled=""/g)).toHaveLength(2);
    expect(markup).not.toContain('>首页</button>');
    expect(markup).not.toContain('>上一页</button>');
  });

  it('服务端分页使用精准总数，加载时保留页码并禁用重复点击', () => {
    const pagination: ExactCursorPagination = {
      limit: 20,
      position: 'next',
      hasPrevious: true,
      hasNext: true,
      previousCursor: 'previous-page',
      nextCursor: 'next-page',
      currentPage: 3,
      totalPages: 6,
      totalItems: 41,
      snapshotCursor: 'admin-snapshot',
    };
    const markup = renderTable({
      items: items.slice(0, 2),
      serverPagination: pagination,
      serverLoading: true,
      onServerNavigate: vi.fn(),
    });

    expect(markup).toContain('本页 2 条 · 共 41 条');
    expect(markup).toContain('aria-label="第 3 页，共 6 页"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/<button[^>]+disabled=""/g)).toHaveLength(4);
  });

  it('允许为同页多表提供独立分页导航名称', () => {
    const markup = renderTable({ items, pageSize: 2, paginationLabel: '用户成本汇总分页导航' });

    expect(markup).toContain('aria-label="用户成本汇总分页导航"');
    expect(markup).not.toContain('aria-label="分页导航"');
  });

  it('单页保留精准总数并隐藏无用的导航', () => {
    const markup = renderTable({ items, pageSize: 20 });

    expect(markup).toContain('共 3 条');
    expect(markup).not.toContain('本页');
    expect(markup).not.toContain('aria-label="分页导航"');
    expect(markup).not.toContain('第 1 页，共 1 页');
  });

  it('空结果沿用表格空状态并隐藏 Dock', () => {
    const markup = renderTable({ items: [] });

    expect(markup).toContain('暂无符合条件的记录');
    expect(markup).toContain('本页 0 条 · 共 0 条');
    expect(markup).not.toContain('aria-label="分页导航"');
  });

  it('明确关闭分页时仍区分本页数量与总数，但不渲染 Dock', () => {
    const markup = renderTable({ items, paginate: false });

    expect(markup).toContain('本页 3 条 · 共 3 条');
    expect(markup).not.toContain('aria-label="分页导航"');
  });
});

function renderTable(overrides: Partial<Parameters<typeof AdminDataTable<{ id: string; name: string }>>[0]> = {}) {
  return renderToStaticMarkup(createElement(AdminDataTable<{ id: string; name: string }>, {
    items: [],
    columns: [{ header: '名称', render: item => item.name }],
    gridTemplate: '1fr',
    ...overrides,
  }));
}

describe('后台套餐素材保留期表单规则', () => {
  const valid = {
    name: '专业版',
    code: 'pro',
    description: '适合稳定创作',
    ctaLabel: '升级专业版',
    monthlyPriceYuan: 29,
    yearlyPriceYuan: 228,
    credits: 10_000,
    assetRetentionDays: 30,
    kind: 'main' as const,
    portraitEnabled: false,
    portraitProfileUnlimited: false,
    portraitProfileLimit: 0,
    portraitActiveLimit: 0,
    portraitAssetsPerActor: 0,
  };

  it('新建主套餐默认永久保留且真人库关闭，加购包真人权益固定为零', () => {
    expect(buildDefaultPlan('main').assetRetentionDays).toBe(0);
    expect(buildDefaultPlan('addon').assetRetentionDays).toBe(0);
    expect(buildDefaultPlan('main').portraitEntitlements).toEqual({
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    });
    expect(buildDefaultPlan('addon').portraitEntitlements).toEqual({
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    });
  });

  it.each([0, 1, 3650])('接受合法保留天数 %s', assetRetentionDays => {
    expect(validatePlanEditForm({ ...valid, assetRetentionDays })).toBe('');
  });

  it.each([-1, 1.5, 3651, null])('拒绝非法保留天数 %s', assetRetentionDays => {
    expect(validatePlanEditForm({ ...valid, assetRetentionDays })).toBe(
      'AI 生成素材保留天数必须是 0 到 3650 的整数',
    );
  });

  it('加购包不使用主套餐保留天数校验', () => {
    expect(validatePlanEditForm({
      ...valid,
      kind: 'addon',
      yearlyPriceYuan: 0,
      assetRetentionDays: null,
    })).toBe('');
  });

  it('启用真人库时校验档案、激活和每人图片额度', () => {
    const portrait = {
      ...valid,
      portraitEnabled: true,
      portraitProfileUnlimited: false,
      portraitProfileLimit: 5,
      portraitActiveLimit: 3,
      portraitAssetsPerActor: 2,
    };

    expect(validatePlanEditForm(portrait)).toBe('');
    expect(validatePlanEditForm({ ...portrait, assetRetentionDays: 0 })).toBe(
      '启用真人演员库时，AI 生成素材保留天数必须是 1 到 3650 的整数',
    );
    expect(validatePlanEditForm({ ...portrait, assetRetentionDays: null })).toBe(
      '启用真人演员库时，AI 生成素材保留天数必须是 1 到 3650 的整数',
    );
    expect(validatePlanEditForm({ ...portrait, portraitProfileLimit: 0 })).toBe(
      '真人演员档案上限必须是正整数，或选择“不限”',
    );
    expect(validatePlanEditForm({ ...portrait, portraitActiveLimit: 0 })).toBe(
      '真人演员同时激活上限必须是正整数',
    );
    expect(validatePlanEditForm({ ...portrait, portraitActiveLimit: 6 })).toBe(
      '真人演员同时激活上限不能超过档案上限',
    );
    expect(validatePlanEditForm({ ...portrait, portraitAssetsPerActor: 3 })).toBe(
      '每名真人演员图片数必须是 1 或 2',
    );
  });

  it('无限档案仍要求正整数激活额度', () => {
    expect(validatePlanEditForm({
      ...valid,
      portraitEnabled: true,
      portraitProfileUnlimited: true,
      portraitProfileLimit: null,
      portraitActiveLimit: 10,
      portraitAssetsPerActor: 2,
    })).toBe('');
  });
});
