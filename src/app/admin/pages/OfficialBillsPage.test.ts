import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import {
  attributionLabel,
  buildOfficialBillsQuery,
  operationalEvidenceLabel,
  operationalEvidenceMetadataLabel,
  purposeLabel,
  readOfficialBillsSelection,
} from './OfficialBillsPage';

describe('官方账单 URL 筛选', () => {
  it('恢复月份、自选周期、全部账期和旧单日链接', () => {
    expect(readOfficialBillsSelection('?range=month&month=2026-07&serviceType=video')).toMatchObject({
      range: 'month', month: '2026-07', serviceType: 'video',
    });
    expect(readOfficialBillsSelection('?range=custom&from=2026-07-02&to=2026-07-18')).toMatchObject({
      range: 'custom', from: '2026-07-02', to: '2026-07-18',
    });
    expect(readOfficialBillsSelection('?range=all')).toMatchObject({ range: 'all' });
    expect(readOfficialBillsSelection('?range=date&date=2026-07-08')).toMatchObject({
      range: 'custom', from: '2026-07-08', to: '2026-07-08',
    });
  });

  it('非法枚举和倒序日期不会进入请求筛选', () => {
    expect(readOfficialBillsSelection('?range=custom&from=2026-07-18&to=2026-07-02&serviceType=compute&finality=draft&attributionStatus=guess')).toMatchObject({
      range: 'month', serviceType: 'all', finality: 'all', attributionStatus: 'all',
    });
  });

  it('生成互斥周期与完整业务筛选参数', () => {
    expect(buildOfficialBillsQuery({
      range: 'custom', month: '2026-07', from: '2026-07-02', to: '2026-07-18',
      product: 'ark', serviceType: 'video', model: 'Seedance 2.5', finality: 'final',
      attributionStatus: 'admin-operational', search: ' landing ',
    })).toBe('range=custom&from=2026-07-02&to=2026-07-18&product=ark&serviceType=video&model=Seedance+2.5&finality=final&attributionStatus=admin-operational&search=landing');
  });
});

describe('官方账单展示边界', () => {
  it('明确区分业务、运营、账户级与待归属账单', () => {
    expect(attributionLabel('business')).toBe('业务调用');
    expect(attributionLabel('admin-operational')).toBe('运营调用');
    expect(attributionLabel('account-level')).toBe('账户级费用');
    expect(attributionLabel('unattributed')).toBe('待归属');
    expect(purposeLabel('deployment-canary')).toBe('发布验证');
    expect(operationalEvidenceLabel({
      origin: 'manifest-v1',
      evidenceStatus: 'admin-confirmed-missing-original',
      evidencePath: '/missing/canary.ndjson',
    })).toBe('管理员确认计入（原始证据缺失）');
    expect(operationalEvidenceLabel({
      origin: 'manifest-v1',
      evidenceStatus: 'verified',
      evidencePath: '/audit/canary.ndjson',
    })).toBe('/audit/canary.ndjson');
    expect(operationalEvidenceMetadataLabel({
      evidenceStatus: 'admin-confirmed-missing-original',
      approvalSha256: 'b'.repeat(64),
      approvedAt: '2026-08-12T02:32:09.000Z',
      evidenceSha256: 'a'.repeat(64),
      manifestSha256: 'c'.repeat(64),
    })).toBe('审批 SHA256 bbbbbbbbbbbb… · 2026-08-12 10:32:09 · 清单 SHA256 cccccccccccc…');
    expect(operationalEvidenceMetadataLabel({
      evidenceStatus: 'verified',
      approvalSha256: null,
      approvedAt: null,
      evidenceSha256: 'a'.repeat(64),
      manifestSha256: 'c'.repeat(64),
    })).toBe('证据 SHA256 aaaaaaaaaaaa… · 清单 SHA256 cccccccccccc…');
  });

  it('页面包含四层官方证据且不把运营调用伪造成业务任务', async () => {
    const source = await readFile(new URL('./OfficialBillsPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('官方原价金额');
    expect(source).toContain('官方优惠后金额');
    expect(source).toContain('官方折扣金额');
    expect(source).toContain('官方优惠券金额');
    expect(source).toContain('官方应付金额');
    expect(source).toContain("header: '原价'");
    expect(source).toContain("header: '优惠后'");
    expect(source).toContain("header: '折扣'");
    expect(source).toContain("header: '优惠券'");
    expect(source).toContain('产品分组');
    expect(source).toContain('逐行官方账单');
    expect(source).toContain('运营调用');
    expect(source).toContain("header: '审计证据'");
    expect(source).toContain('item.evidenceSha256');
    expect(source).toContain('item.manifestSha256');
    expect(source).toContain('item.approvalSha256');
    expect(source).toContain('item.approvedAt');
    expect(source).toContain('管理员确认计入（原始证据缺失）');
    expect(source).toContain('不伪造前端业务任务');
    expect(source).toContain('账户级费用不按模型或业务任务伪分摊');
    expect(source).toContain('待归属表示当前证据不足');
    expect(source).toContain('列表价估算与官方实际应付保持分账展示');
  });
});
