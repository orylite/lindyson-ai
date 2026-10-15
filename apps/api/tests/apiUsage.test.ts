import { describe, expect, it } from 'vitest';
import { sortProviderPackagesBySubscription } from '../src/domain/apiUsage.js';
import { seedanceModelOrder } from '../src/domain/seedanceModels.js';

describe('apiUsage', () => {
  it('官方资源包实例按最近订阅时间优先展示', () => {
    const rows = sortProviderPackagesBySubscription([
      {
        package_id: 'old',
        starts_at: '2026-06-07T13:20:09.000Z',
        expires_at: '2026-09-04T15:59:59.000Z',
        updated_at: '2026-06-30T16:27:23.244Z',
      },
      {
        package_id: 'latest',
        starts_at: '2026-06-30T15:14:19.000Z',
        expires_at: '2026-09-27T15:59:59.000Z',
        updated_at: '2026-06-30T16:27:23.244Z',
      },
    ]);

    expect(rows.map(row => row.package_id)).toEqual(['latest', 'old']);
  });

  it('订阅时间为空的资源包排在最后', () => {
    const rows = sortProviderPackagesBySubscription([
      {
        package_id: 'empty-start',
        starts_at: null,
        expires_at: '2026-12-31T15:59:59.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        package_id: 'has-start',
        starts_at: '2026-06-01T00:00:00.000Z',
        expires_at: '2026-08-31T15:59:59.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
    ]);

    expect(rows.map(row => row.package_id)).toEqual(['has-start', 'empty-start']);
  });

  it('同一订阅时间下按到期、更新时间和包 ID 稳定排序', () => {
    const rows = sortProviderPackagesBySubscription([
      {
        package_id: 'pkg-a',
        starts_at: '2026-06-30T15:14:19.000Z',
        expires_at: '2026-09-04T15:59:59.000Z',
        updated_at: '2026-06-30T16:27:23.244Z',
      },
      {
        package_id: 'pkg-b',
        starts_at: '2026-06-30T15:14:19.000Z',
        expires_at: '2026-09-27T15:59:59.000Z',
        updated_at: '2026-06-30T16:27:23.244Z',
      },
      {
        package_id: 'pkg-d',
        starts_at: '2026-06-30T15:14:19.000Z',
        expires_at: '2026-09-27T15:59:59.000Z',
        updated_at: '2026-06-30T16:27:23.244Z',
      },
      {
        package_id: 'pkg-c',
        starts_at: '2026-06-30T15:14:19.000Z',
        expires_at: '2026-09-27T15:59:59.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ]);

    expect(rows.map(row => row.package_id)).toEqual(['pkg-c', 'pkg-d', 'pkg-b', 'pkg-a']);
  });

  it('后台 Seedance 模型按普通版、Fast、Mini 稳定排序', () => {
    expect([
      'Seedance 2.0 Mini',
      'Seedance 2.0 Fast',
      'Seedance 2.0',
    ].sort((left, right) => seedanceModelOrder(left) - seedanceModelOrder(right))).toEqual([
      'Seedance 2.0',
      'Seedance 2.0 Fast',
      'Seedance 2.0 Mini',
    ]);
  });
});
