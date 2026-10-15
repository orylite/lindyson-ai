import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import {
  buildCostOverviewQuery,
  buildOfficialBillsEntryPath,
  costValue,
  creditValue,
  priceVersionsLabel,
  readCostOverviewSelection,
  reconciliationHelper,
  reconciliationLabel,
  taskCostLabel,
  taskCompletenessDetail,
} from './ApiCostOverviewPage';

describe('成本看盘 URL 筛选', () => {
  it('恢复正式 custom 周期、旧 from/to 和旧单日链接', () => {
    expect(readCostOverviewSelection('?range=custom&from=2026-06-03&to=2026-06-18&model=Seedance+2.0+Fast')).toMatchObject({
      range: 'custom', from: '2026-06-03', to: '2026-06-18', model: 'Seedance 2.0 Fast',
    });
    expect(readCostOverviewSelection('?from=2026-06-03&to=2026-06-18')).toMatchObject({
      range: 'custom', from: '2026-06-03', to: '2026-06-18',
    });
    expect(readCostOverviewSelection('?range=date&date=2026-06-08')).toMatchObject({
      costType: 'video', range: 'custom', from: '2026-06-08', to: '2026-06-08',
    });
    expect(readCostOverviewSelection('?costType=multimodal&range=month&month=2026-06')).toMatchObject({
      costType: 'multimodal', range: 'month', month: '2026-06', model: 'all',
    });
    expect(readCostOverviewSelection('?costType=image&range=month&month=2026-06')).toMatchObject({
      costType: 'image', range: 'month', month: '2026-06', model: 'all',
    });
  });

  it('缺少端点、倒序和非法日期回退当前月', () => {
    expect(readCostOverviewSelection('?range=custom&from=2026-06-03').range).toBe('month');
    expect(readCostOverviewSelection('?range=custom&from=2026-06-18&to=2026-06-03').range).toBe('month');
    expect(readCostOverviewSelection('?range=custom&from=2026-02-31&to=2026-03-01').range).toBe('month');
  });

  it('月份与自选周期生成互斥的规范查询参数', () => {
    expect(buildCostOverviewQuery({
      costType: 'video', range: 'month', month: '2026-06', from: '2026-06-01', to: '2026-06-30', model: 'all',
    })).toBe('costType=video&range=month&month=2026-06');
    expect(buildCostOverviewQuery({
      costType: 'video', range: 'custom', month: '2026-06', from: '2026-06-03', to: '2026-06-18', model: 'Seedance 2.0 Mini',
    })).toBe('costType=video&range=custom&from=2026-06-03&to=2026-06-18&model=Seedance+2.0+Mini');
    expect(buildCostOverviewQuery({
      costType: 'multimodal', range: 'custom', month: '2026-06', from: '2026-06-03', to: '2026-06-18', model: 'Seedance 2.0 Mini',
    })).toBe('costType=multimodal&range=custom&from=2026-06-03&to=2026-06-18');
    expect(buildCostOverviewQuery({
      costType: 'image', range: 'month', month: '2026-06', from: '2026-06-01', to: '2026-06-30', model: 'Seedance 2.0 Mini',
    })).toBe('costType=image&range=month&month=2026-06');
  });

  it('保留 Seedance 2.5 模型筛选', () => {
    expect(readCostOverviewSelection('?range=month&month=2026-08&model=Seedance+2.5').model).toBe('Seedance 2.5');
  });

  it('按当前成本类型进入独立官方账单页并保留周期', () => {
    expect(buildOfficialBillsEntryPath('?costType=image&range=month&month=2026-08')).toBe(
      '/admin/api-usage/bills?range=month&month=2026-08&serviceType=image',
    );
    expect(buildOfficialBillsEntryPath('?costType=video&range=custom&from=2026-08-01&to=2026-08-12&model=Seedance+2.5')).toBe(
      '/admin/api-usage/bills?range=custom&from=2026-08-01&to=2026-08-12&model=Seedance+2.5&serviceType=video',
    );
  });
});

describe('任务供应商估算成本显示', () => {
  it('区分完整、部分和不可用成本', () => {
    expect(costValue('12.021300', 'complete')).toBe('¥12.021300');
    expect(costValue('12.021300', 'partial')).toBe('¥12.021300+');
    expect(costValue(null, 'unavailable')).toBe('待核对');
  });

  it('页面明确估算成本不是实际应付，且不虚构毛利', async () => {
    const source = await readFile(new URL('./ApiCostOverviewPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('本期供应商估算成本');
    expect(source).toContain('估算值不等同于实际应付');
    expect(source).toContain("['最终实扣积分', creditValue(task)]");
    expect(source).toContain("['价格版本', priceVersionsLabel(task.priceVersions)]");
    expect(source).toContain("['成本完整性'");
    expect(source).toContain("['成本确认 / 对账案件'");
    expect(source).toContain("header: '账户级对账'");
    expect(source).toContain('官方账单不按模型逐项分摊');
    expect(source).toContain('不进行官方逐任务匹配');
    expect(source).toContain('平台调用按实际发生时间归属');
    expect(source).toContain('平台调用价格快照');
    expect(source).not.toContain('毛利');
  });

  it('任务详情展示去重价格版本并解释成本完整性缺口', () => {
    expect(priceVersionsLabel([
      'volcengine-seedance-2026-06-01',
      'volcengine-seedance-2026-07-10',
    ])).toBe('volcengine-seedance-2026-06-01、volcengine-seedance-2026-07-10');
    expect(priceVersionsLabel([])).toBe('未命中价格版本');
    expect(taskCompletenessDetail({ missingUsageAttempts: 2, unpricedAttempts: 1 })).toBe(
      '2 次 attempt 缺少用量 · 1 次 attempt 未计价',
    );
    expect(taskCompletenessDetail({ missingUsageAttempts: 0, unpricedAttempts: 0 })).toBe(
      '已知 attempt 均具备用量与有效价格证据',
    );
  });

  it('优先展示终账确认状态，不把缺失用量伪装成零 Token 回执', () => {
    expect(taskCostLabel({
      costResolutionStatus: 'pending-final-bill',
      estimatedCostCny: '0.000000',
      estimateCompleteness: 'unavailable',
    })).toBe('待终账确认');
    expect(taskCostLabel({
      costResolutionStatus: 'approved-zero',
      estimatedCostCny: '0.000000',
      estimateCompleteness: 'complete',
    })).toBe('¥0.000000 · 审计确认零成本');
    expect(taskCostLabel({
      costResolutionStatus: 'recorded',
      estimatedCostCny: '12.021300',
      estimateCompleteness: 'complete',
    })).toBe('¥12.021300');
  });

  it('积分只显示最终结算，预扣与退款不会伪装成实扣', () => {
    expect(creditValue({
      creditStatus: 'settled', settledCredits: 120, reservedCredits: 120, refundedCredits: 0,
    })).toBe('120');
    expect(creditValue({
      creditStatus: 'held', settledCredits: 0, reservedCredits: 120, refundedCredits: 0,
    })).toBe('待结算（预扣 120）');
    expect(creditValue({
      creditStatus: 'refunded', settledCredits: 0, reservedCredits: 120, refundedCredits: 120,
    })).toBe('0（已退 120）');
  });

  it('把官方经营对账状态翻译为简洁结论', () => {
    expect(reconciliationLabel('matched', 0, '0.000000')).toBe('已对上');
    expect(reconciliationLabel('incomplete', 2, '0.000000')).toBe('已知金额已对上，2 项待补');
    expect(reconciliationLabel('incomplete', 3, '0.000000', 3, 0)).toBe('已知金额已对上，3 项待最终账单确认');
    expect(reconciliationLabel('matched', 0, '0.000000', 0, 3)).toBe('已对上，3 项审计确认零成本');
    expect(reconciliationLabel('matched-adjusted', 0, '1.164674')).toBe('存在跨期计费，已归因');
    expect(reconciliationLabel('difference', 0, '5.000000')).toBe('有未解释差额');
    expect(reconciliationLabel('unavailable', 0, null)).toBe('待同步');
  });

  it('动态列出待建案、待终账与已确认数量，不写死历史分类', () => {
    expect(reconciliationHelper({
      officialEquivalentCostCny: '442.913331',
      knownAccountCostCny: '442.913331',
      differenceCny: '0.000000',
      unresolvedTaskCount: 2,
      pendingFinalBillTaskCount: 12,
      approvedZeroCostTaskCount: 1,
    })).toBe('官方同价折算 ¥442.913331 · 本地账户已知 ¥442.913331 · 已知差额 ¥0.000000 · 应付/已付/未付请查看官方账单 · 2 项待建案 · 12 项待终账 · 1 项已确认零成本');
  });
});
