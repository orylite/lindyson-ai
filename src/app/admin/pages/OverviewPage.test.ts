import { describe,expect,it } from 'vitest';
import { buildUsageMix } from './OverviewPage';

describe('管理员仪表盘模型使用占比', () => {
  it('展示当前全部生产模型，并为没有成功用量的模型保留 0% 明细', () => {
    const result = buildUsageMix([
      { model: 'Seedance 2.0', billableTokens: 73 },
      { model: 'Seedance 2.0 Mini', billableTokens: 19 },
      { model: 'Seedance 2.0 Fast', billableTokens: 8 },
    ]);

    expect(result).toEqual([
      { name: 'Seedance 2.0', value: 73, color: '#8b5cf6' },
      { name: 'Seedance 2.0 Mini', value: 19, color: '#3b82f6' },
      { name: 'Seedance 2.0 Fast', value: 8, color: '#ef4444' },
      { name: 'Doubao Seed 2.0 Lite', value: 0, color: '#22c55e' },
      { name: 'Seedance 2.5', value: 0, color: '#f59e0b' },
      { name: 'Seedream 5.0 Pro', value: 0, color: '#06b6d4' },
    ]);
  });

  it('继续展示后端返回的未来模型', () => {
    const result = buildUsageMix([
      { model: '未来模型', billableTokens: 1 },
    ]);

    expect(result.map(item => [item.name, item.value])).toEqual([
      ['未来模型', 100],
      ['Doubao Seed 2.0 Lite', 0],
      ['Seedance 2.0', 0],
      ['Seedance 2.0 Fast', 0],
      ['Seedance 2.0 Mini', 0],
      ['Seedance 2.5', 0],
      ['Seedream 5.0 Pro', 0],
    ]);
  });
});

describe('管理员仪表盘流量来源', () => {
  it('按访客数排序、换成中文标签，计算访客占比与注册转化', async () => {
    const { buildTrafficSources } = await import('./OverviewPage');
    const result = buildTrafficSources({
      visitors: 40,
      newVisitors: 30,
      registrations: 3,
      items: [
        { source: 'direct', visitors: 10, newVisitors: 5, registrations: 1, paidUsers: 0, revenue: 0 },
        { source: 'xiaohongshu', visitors: 30, newVisitors: 25, registrations: 2, paidUsers: 1, revenue: 19900 },
      ],
    });
    expect(result.items.map(item => [item.label, item.share, item.conversion])).toEqual([
      ['小红书', 75, '6.7%'],
      ['直接访问', 25, '10%'],
    ]);
  });

  it('只有注册没有访客记录的来源（如上线前的访客）转化率显示为 —', async () => {
    const { buildTrafficSources, formatConversion } = await import('./OverviewPage');
    const result = buildTrafficSources({
      visitors: 0, newVisitors: 0, registrations: 1,
      items: [{ source: 'referral', visitors: 0, newVisitors: 0, registrations: 1, paidUsers: 0, revenue: 0 }],
    });
    expect(result.items[0]).toMatchObject({ label: '邀约', share: 0, conversion: '—' });
    expect(formatConversion(0, 20)).toBe('0%');
  });
});
