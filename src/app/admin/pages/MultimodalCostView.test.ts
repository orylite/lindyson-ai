import { describe, expect, it } from 'vitest';
import type { AdminMultimodalCostOverview } from '../../data/admin';
import {
  completenessLabel,
  historicalCoverageLabel,
  knownCostValue,
  uniquePricingSources,
  usageEvidenceLabel,
} from './MultimodalCostView';

describe('多模态成本完整性文案', () => {
  it('单独显示历史证据不足，不生成零项待核对', () => {
    expect(completenessLabel('partial', 0, 0, 5)).toBe('部分 · 5 项历史证据不足');
    expect(completenessLabel('partial', 0, 0, 0)).toBe('部分 · 完整性原因待核对');
  });

  it('分别说明未知用量、未定价和历史证据缺口', () => {
    expect(completenessLabel('partial', 2, 1, 5)).toBe(
      '部分 · 2 次用量未知 · 1 次未定价 · 5 项历史证据不足',
    );
  });

  it('历史证据仍不完整时保留已知成本加号', () => {
    expect(knownCostValue('0.942022', 'partial')).toBe('¥0.942022+');
    expect(knownCostValue('0.000000', 'complete')).toBe('¥0.000000');
  });

  it('历史聚合已全部定价时显示完整金额且不追加加号', () => {
    expect(knownCostValue('1.019045', 'complete')).toBe('¥1.019045');
    expect(completenessLabel('complete', 0, 0, 0, 5)).toBe(
      '完整 · 5 项历史聚合 Token 已定价',
    );
    expect(historicalCoverageLabel(5, 0)).toBe(
      '5 项历史聚合 Token 已定价、0 项历史证据不足',
    );
  });

  it('旧接口缺少历史已定价计数时按零展示', () => {
    expect(historicalCoverageLabel(undefined, undefined)).toBe(
      '0 项历史聚合 Token 已定价、0 项历史证据不足',
    );
  });
});

describe('多模态成本核对证据', () => {
  it('把已核对零用量标记为逐请求账本加官方核对', () => {
    expect(usageEvidenceLabel('ledger-reconciled')).toBe('逐请求账本 + 官方核对');
  });

  it('把历史聚合定价与逐请求账本明确区分', () => {
    expect(usageEvidenceLabel('historical-aggregate-priced')).toBe('历史聚合 Token 定价');
  });

  it('按价格版本与链接去重官方价格来源', () => {
    const source = {
      priceVersion: 'volcengine-list-2026-07-23',
      sourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
    };
    const models = [
      { pricingSources: [source] },
      { pricingSources: [source] },
    ] as AdminMultimodalCostOverview['models'];

    expect(uniquePricingSources(models)).toEqual([source]);
  });
});
