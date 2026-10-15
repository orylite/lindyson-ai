import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canUsePortraitActor,
  occupiesPortraitActiveSlot,
  rankPortraitActorsForRetention,
  type RealPortraitActor,
} from '../data/realPortraits';

function actor(overrides: Partial<RealPortraitActor> = {}): RealPortraitActor {
  return {
    id: 'actor-1',
    alias: '演员一号',
    planAccessStatus: 'available',
    lifecycleStatus: 'active',
    authorizationStatus: 'active',
    authorizationExpiresAt: '2026-10-30T00:00:00.000Z',
    lastSuccessfulGenerationAt: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    assets: [{ id: 'portrait-asset-1', kind: 'primary', status: 'active', consistencyStatus: 'passed' }],
    ...overrides,
  };
}

describe('真人演员库可用性', () => {
  it('只有套餐可用、授权有效、主图通过校验且已激活的演员可被生成器展示', () => {
    expect(canUsePortraitActor(actor())).toBe(true);
    expect(canUsePortraitActor(actor({ planAccessStatus: 'plan_locked' }))).toBe(false);
    expect(canUsePortraitActor(actor({ authorizationStatus: 'revoked' }))).toBe(false);
    expect(canUsePortraitActor(actor({ lifecycleStatus: 'awaiting_upload' }))).toBe(false);
    expect(canUsePortraitActor(actor({ assets: [{ id: 'primary', kind: 'primary', status: 'active', consistencyStatus: 'failed' }] }))).toBe(false);
    expect(canUsePortraitActor(actor({ assets: [{ id: 'primary', kind: 'primary', status: 'failed', consistencyStatus: 'failed' }] }))).toBe(false);
  });

  it('套餐锁定仍是档案状态，不能因为存在第二张或其他素材绕过主图要求', () => {
    expect(canUsePortraitActor(actor({
      planAccessStatus: 'plan_locked',
      assets: [
        { id: 'primary', kind: 'primary', status: 'active', consistencyStatus: 'passed' },
        { id: 'secondary', kind: 'secondary', status: 'active', consistencyStatus: 'passed' },
      ],
    }))).toBe(false);

    expect(canUsePortraitActor(actor({
      assets: [{ id: 'secondary-only', kind: 'secondary', status: 'active', consistencyStatus: 'passed' }],
    }))).toBe(false);
  });

  it('激活额度满时要求用户主动选择释放，且不会在远端删除确认前自动激活新人', () => {
    const source = readFileSync(new URL('./RealPortraitLibrary.tsx', import.meta.url), 'utf8');
    expect(source).toContain('选择释放名额');
    expect(source).toContain('供应商确认删除前仍占用容量');
    expect(source).toContain('再次使用该演员必须由真人本人重新同意并完成官方 H5 认证');
    const replacementHandler = source.match(/onRelease=\{async actorId => \{[\s\S]*?\n\s*\}\}/)?.[0] ?? '';
    expect(replacementHandler).toContain('await onRevoke(actorId)');
    expect(replacementHandler).not.toContain('onActivate');
  });

  it('释放和删除使用站内确认对话框，接口失败时保留对话框并明确提示', () => {
    const source = readFileSync(new URL('./RealPortraitLibrary.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('window.confirm');
    expect(source).toContain('role="alertdialog"');
    expect(source).toContain('data-dialog-initial-focus');
    expect(source).toContain("setConfirmAction('revoke')");
    expect(source).toContain("setConfirmAction('delete')");
    expect(source).toContain("toast.error(message)");
    expect(source).toContain('已停止使用；远端清理完成后即可删除档案');
  });

  it('用户端不展示平台全局真人容量，只展示本账号套餐额度', () => {
    const source = readFileSync(new URL('./RealPortraitLibrary.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('全局共享容量');
    expect(source).not.toContain('global.groupsUsed');
    expect(source).not.toContain('global.assetsUsed');
    expect(source).toContain('演员档案');
    expect(source).toContain('同时激活');
    expect(source).toContain('套餐权益');
  });

  it('邀请链接始终显示供手动保存，剪贴板失败时不会谎报已复制', () => {
    const source = readFileSync(new URL('./RealPortraitLibrary.tsx', import.meta.url), 'utf8');
    expect(source).toContain('id="portrait-invitation-url"');
    expect(source).toContain('请手动选中并复制下方链接');
    expect(source).toContain('本人认证邀请已创建，请发送给真人本人');
    expect(source).not.toContain('本人认证邀请已创建并复制');
  });

  it('降级默认先保留最近成功使用者，未使用者再按最近创建排序', () => {
    const ranked = rankPortraitActorsForRetention([
      actor({ id: 'never-old', createdAt: '2026-07-01T00:00:00.000Z', lastSuccessfulGenerationAt: null }),
      actor({ id: 'used-old', createdAt: '2026-06-01T00:00:00.000Z', lastSuccessfulGenerationAt: '2026-07-20T00:00:00.000Z' }),
      actor({ id: 'never-new', createdAt: '2026-07-29T00:00:00.000Z', lastSuccessfulGenerationAt: null }),
      actor({ id: 'used-new', createdAt: '2026-05-01T00:00:00.000Z', lastSuccessfulGenerationAt: '2026-07-28T00:00:00.000Z' }),
    ]);
    expect(ranked.map(item => item.id)).toEqual(['used-new', 'used-old', 'never-new', 'never-old']);
  });

  it('用户保存降级选择后仍可在截止前查看倒计时并修改选择', () => {
    const source = readFileSync(new URL('./RealPortraitLibrary.tsx', import.meta.url), 'utf8');
    expect(source).toContain("['active', 'reconciling'].includes(graceStatus)");
    expect(source).toContain("graceStatus === 'reconciling' ? '修改保留演员' : '选择保留演员'");
    expect(source).toContain('截止前可以修改');
    expect(source).toContain('套餐额度调整清理中');
  });

  it('草稿、撤回和已释放演员不能被选作降级后的驻留演员', () => {
    expect(occupiesPortraitActiveSlot(actor({ lifecycleStatus: 'active' }))).toBe(true);
    expect(occupiesPortraitActiveSlot(actor({ lifecycleStatus: 'verifying' }))).toBe(true);
    expect(occupiesPortraitActiveSlot(actor({ lifecycleStatus: 'draft' }))).toBe(false);
    expect(occupiesPortraitActiveSlot(actor({ lifecycleStatus: 'revoked' }))).toBe(false);
    expect(occupiesPortraitActiveSlot(actor({ lifecycleStatus: 'evicted' }))).toBe(false);
  });
});
