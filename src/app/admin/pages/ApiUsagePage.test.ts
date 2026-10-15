import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import {
  buildApiCostOverviewPath,
  buildApiCostChartData,
  formatBookToken,
  formatNoPackageProjection,
  formatReconciliationVariancePair,
  localEstimateHelper,
  readApiUsageUrlSelection,
} from './ApiUsagePage';

describe('API 成本看盘 URL 筛选', () => {
  it('恢复日期、模型与范围', () => {
    expect(readApiUsageUrlSelection('?range=date&date=2026-07-01&model=Seedance+2.0+Fast')).toMatchObject({
      range: 'date',
      date: '2026-07-01',
      model: 'Seedance 2.0 Fast',
    });
  });

  it('拒绝不存在的日期和未来月份', () => {
    const invalidDate = readApiUsageUrlSelection('?range=date&date=2026-02-31');
    const futureMonth = readApiUsageUrlSelection('?range=month&month=2999-01');

    expect(invalidDate.date).not.toBe('2026-02-31');
    expect(futureMonth.month).not.toBe('2999-01');
  });

  it('未知范围和模型回退到当前月与全部模型', () => {
    expect(readApiUsageUrlSelection('?range=quarter&model=unknown')).toMatchObject({
      range: 'month',
      model: 'all',
    });
  });

  it('恢复自选周期并把同一筛选带回成本看盘的视频视图', () => {
    const selection = readApiUsageUrlSelection('?range=custom&from=2026-06-08&to=2026-07-01&model=Seedance+2.0+Mini');

    expect(selection).toMatchObject({
      range: 'custom',
      from: '2026-06-08',
      to: '2026-07-01',
      model: 'Seedance 2.0 Mini',
    });
    expect(buildApiCostOverviewPath(selection)).toBe(
      '/admin/api-usage?costType=video&range=custom&from=2026-06-08&to=2026-07-01&model=Seedance+2.0+Mini',
    );
  });

  it('把高级页单日和全部范围转换为主看盘支持的自选周期', () => {
    const dateSelection = readApiUsageUrlSelection('?range=date&date=2026-06-15&model=Seedance+2.0');
    expect(buildApiCostOverviewPath(dateSelection)).toBe(
      '/admin/api-usage?costType=video&range=custom&from=2026-06-15&to=2026-06-15&model=Seedance+2.0',
    );

    const allSelection = readApiUsageUrlSelection('?range=all&model=Seedance+2.0+Fast');
    expect(buildApiCostOverviewPath(allSelection, {
      rangeStart: '2026-05-01', rangeEnd: '2026-07-14',
    })).toBe(
      '/admin/api-usage?costType=video&range=custom&from=2026-05-01&to=2026-07-14&model=Seedance+2.0+Fast',
    );
  });

  it('兼容只有旧 from/to 参数的深链接', () => {
    expect(readApiUsageUrlSelection('?from=2026-06-01&to=2026-06-30')).toMatchObject({
      range: 'custom',
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });

  it('拒绝倒置或未来的自选周期', () => {
    const inverted = readApiUsageUrlSelection('?range=custom&from=2026-07-10&to=2026-07-01');
    const future = readApiUsageUrlSelection('?range=custom&from=2026-07-01&to=2999-01-01');

    expect(inverted.from <= inverted.to).toBe(true);
    expect(future.to).not.toBe('2999-01-01');
  });
});

describe('API 成本趋势空值', () => {
  it('覆盖范围外保持 null，覆盖范围内真实零保持 0', () => {
    const result = buildApiCostChartData([
      {
        day: '2026-07-01',
        localBillableTokens: 0,
        localEstimatedCostCny: '0.000000',
        localUnpricedAttempts: 0,
        localUnavailableUsageAttempts: 0,
        localEstimateCompleteness: 'complete',
        officialBillableTokens: null,
        officialListEquivalentCostCny: null,
        officialPayableAmountCny: null,
      },
    ], 'day');

    expect(result[0]).toEqual({
      period: '07-01',
      本地列表价估算: 0,
      官方用量列表价折算: null,
      用量账单应付: null,
    });
  });

  it('部分估值仍把已知成本小计交给趋势图', () => {
    const result = buildApiCostChartData([{
      day: '2026-07-02',
      localBillableTokens: 324_900,
      localEstimatedCostCny: '12.021300',
      localUnpricedAttempts: 1,
      localUnavailableUsageAttempts: 1,
      localEstimateCompleteness: 'partial',
      officialBillableTokens: null,
      officialListEquivalentCostCny: null,
      officialPayableAmountCny: null,
    }], 'day');

    expect(result[0]?.本地列表价估算).toBe(12.0213);
  });

  it('桶级费率与舍入未拆分时不伪装成零差异', () => {
    expect(formatReconciliationVariancePair(null, null)).toBe(
      '未独立计算（保留在残差） / 未独立计算（保留在残差）',
    );
  });

  it('共同覆盖不可用时 Token 主卡不伪装成零', () => {
    expect(formatBookToken(null)).toBe('数据不可用');
    expect(formatBookToken(0)).toBe('0 Token');
  });
});

describe('无套餐预测覆盖状态', () => {
  it('无官方覆盖时不把不可计算伪装为零元', () => {
    expect(formatNoPackageProjection({
      noPackageProjectedDailyCostCny: null,
      noPackageRunwayDays: null,
      noPackageProjectionCoveredDays: 0,
      noPackageProjectionUnpricedRows: 0,
      noPackageProjectionUnpricedTokens: 0,
      noPackageProjectionStatus: 'unavailable',
    }, null)).toMatchObject({ value: '数据不足' });
  });

  it('部分覆盖时明确展示参与预测的天数', () => {
    expect(formatNoPackageProjection({
      noPackageProjectedDailyCostCny: '23.520000',
      noPackageRunwayDays: 2,
      noPackageProjectionCoveredDays: 3,
      noPackageProjectionUnpricedRows: 0,
      noPackageProjectionUnpricedTokens: 0,
      noPackageProjectionStatus: 'partial',
    }, '47.040000')).toMatchObject({
      value: '¥23.520000/天',
      helper: expect.stringContaining('仅 3 日可比'),
    });
  });

  it('存在未知单价时拒绝输出无套餐金额', () => {
    expect(formatNoPackageProjection({
      noPackageProjectedDailyCostCny: null,
      noPackageRunwayDays: null,
      noPackageProjectionCoveredDays: 5,
      noPackageProjectionUnpricedRows: 2,
      noPackageProjectionUnpricedTokens: 108_900,
      noPackageProjectionStatus: 'unpriced',
    }, null)).toMatchObject({
      value: '存在未计价用量',
      helper: expect.stringContaining('108,900 Token'),
    });
  });

  it('预测日耗已知但余额缺失时不误报为零日耗', () => {
    expect(formatNoPackageProjection({
      noPackageProjectedDailyCostCny: '23.520000',
      noPackageRunwayDays: null,
      noPackageProjectionCoveredDays: 7,
      noPackageProjectionUnpricedRows: 0,
      noPackageProjectionUnpricedTokens: 0,
      noPackageProjectionStatus: 'complete',
    }, null)).toMatchObject({
      value: '¥23.520000/天',
      helper: expect.stringContaining('账户余额数据不可用'),
    });
  });
});

describe('本地估算覆盖状态', () => {
  it('模型卡明确使用估算成本口径', async () => {
    const source = await readFile(new URL('./ApiUsagePage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('单个成功视频估算成本');
    expect(source).toContain('每输出秒估算成本');
    expect(source).toContain('失败估算成本');
  });

  it('无覆盖时不把未知金额解释成零', () => {
    expect(localEstimateHelper(null, 'unavailable', '正常说明', null, null)).toContain('未知金额未被当作 0');
  });

  it('部分估值保留已知小计并分别说明计价和用量缺口', () => {
    expect(localEstimateHelper('12.021300', 'partial', '正常说明', 2, 1)).toBe(
      '当前金额仅为已知小计；正 Token 未计价 2 次；NULL 用量缺失 1 次，已知金额不代表完整成本。',
    );
  });

  it('完整估值保留正常说明和真实零金额', () => {
    expect(localEstimateHelper('0.000000', 'complete', '正常说明', 0, 0)).toBe('正常说明');
  });
});
