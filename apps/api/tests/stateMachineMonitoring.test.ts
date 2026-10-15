import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ poolQuery: vi.fn() }));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

import {
  collectStateMachineMonitoringSnapshot,
  createStateMachineMonitoringLogGate,
  createStateMachineMonitoringSampler,
  emptyStateMachineMonitoringSnapshot,
  stateMachineMonitoringAnomalies,
} from '../src/domain/stateMachineMonitoring.js';

describe('状态机生产监控', () => {
  beforeEach(() => mocks.poolQuery.mockReset());

  it('用单条只读聚合 SQL 返回状态机、租约、账本和对象清理指标', async () => {
    mocks.poolQuery.mockResolvedValue(result([monitoringRow()]));

    const snapshot = await collectStateMachineMonitoringSnapshot();

    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.poolQuery.mock.calls[0]!;
    expect(String(sql)).toContain('FROM payment_attempts');
    expect(String(sql)).toContain('FROM order_refund_attempts');
    expect(String(sql)).toContain('FROM generation_provider_runs');
    expect(String(sql)).toContain('FROM upload_sessions');
    expect(String(sql)).toContain('FROM assets');
    expect(String(sql)).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(params).toEqual(['(不匹配|不一致|冲突|mismatch|conflict)']);
    expect(snapshot).toEqual({
      available: true,
      checkedAt: '2026-07-16T10:00:00.000Z',
      nonTerminal: {
        payment: { count: 2, maxAgeSeconds: 120 },
        refund: { count: 3, maxAgeSeconds: 240 },
        generation: { count: 4, maxAgeSeconds: 360 },
        upload: { count: 5, maxAgeSeconds: 480 },
      },
      expiredLeases: {
        payment: 1,
        refund: 2,
        generation: 3,
        upload: 4,
        objectDeletion: 5,
        paymentNotification: 6,
        total: 21,
      },
      manualReview: { payment: 7, refund: 8, generation: 9, total: 24 },
      providerIntegrity: {
        fieldConflicts: 6,
        rejectedEvents: 10,
        rejectedEventsLast24Hours: 4,
      },
      creditBalanceMismatchUsers: 11,
      uploadStagingOrphans: 12,
      assetThumbnails: { pending: 15, failed: 16 },
      objectDeletionOutbox: {
        backlog: 13,
        dueBacklog: 14,
        maxAgeSeconds: 900,
        maxDueAgeSeconds: 600,
      },
    });
  });

  it('没有非终态记录时保留 null 年龄，不把未知值伪装成 0 秒', async () => {
    mocks.poolQuery.mockResolvedValue(result([monitoringRow({
      payment_non_terminal_count: '0',
      payment_max_age_seconds: null,
      refund_non_terminal_count: '0',
      refund_max_age_seconds: null,
      generation_non_terminal_count: '0',
      generation_max_age_seconds: null,
      upload_non_terminal_count: '0',
      upload_max_age_seconds: null,
      object_deletion_max_due_age_seconds: null,
    })]));

    const snapshot = await collectStateMachineMonitoringSnapshot();

    expect(snapshot.nonTerminal.payment).toEqual({ count: 0, maxAgeSeconds: null });
    expect(snapshot.nonTerminal.refund.maxAgeSeconds).toBeNull();
    expect(snapshot.nonTerminal.generation.maxAgeSeconds).toBeNull();
    expect(snapshot.nonTerminal.upload.maxAgeSeconds).toBeNull();
    expect(snapshot.objectDeletionOutbox.maxDueAgeSeconds).toBeNull();
  });

  it('把必须为零的完整性指标和超过五分钟的删除积压标为异常', () => {
    const snapshot = healthySnapshot();
    snapshot.expiredLeases.total = 1;
    snapshot.manualReview.total = 1;
    snapshot.providerIntegrity.fieldConflicts = 1;
    snapshot.providerIntegrity.rejectedEvents = 1;
    snapshot.providerIntegrity.rejectedEventsLast24Hours = 1;
    snapshot.creditBalanceMismatchUsers = 1;
    snapshot.uploadStagingOrphans = 1;
    snapshot.assetThumbnails = { pending: 1, failed: 1 };
    snapshot.objectDeletionOutbox = {
      backlog: 2,
      dueBacklog: 1,
      maxAgeSeconds: 600,
      maxDueAgeSeconds: 300,
    };

    expect(stateMachineMonitoringAnomalies(snapshot)).toEqual([
      'expired-leases',
      'manual-review',
      'provider-field-conflicts',
      'provider-events-rejected',
      'credit-balance-mismatch',
      'upload-staging-orphans',
      'asset-thumbnails-pending',
      'asset-thumbnails-failed',
      'object-deletion-backlog',
    ]);
    expect(stateMachineMonitoringAnomalies(emptyStateMachineMonitoringSnapshot())).toContain(
      'monitoring-unavailable',
    );
  });

  it('异常变化即时输出，稳定状态每五分钟输出一次，并记录恢复', () => {
    const gate = createStateMachineMonitoringLogGate(300_000);
    const healthy = healthySnapshot();

    expect(gate(healthy, 1_000)).toMatchObject({ level: 'info', kind: 'snapshot', anomalies: [] });
    expect(gate(healthy, 2_000)).toBeNull();

    const unhealthy = structuredClone(healthy);
    unhealthy.creditBalanceMismatchUsers = 2;
    expect(gate(unhealthy, 3_000)).toMatchObject({
      level: 'warn', kind: 'anomaly', anomalies: ['credit-balance-mismatch'],
    });
    expect(gate(unhealthy, 4_000)).toBeNull();
    expect(gate(unhealthy, 303_000)).toMatchObject({ level: 'warn', kind: 'anomaly' });
    expect(gate(healthy, 304_000)).toMatchObject({ level: 'info', kind: 'recovered', anomalies: [] });
  });

  it('worker 高频维护循环复用一分钟内的成功快照，并合并并发采样', async () => {
    let now = 1_000;
    let resolveFirst!: (snapshot: ReturnType<typeof healthySnapshot>) => void;
    const collect = vi.fn(() => new Promise<ReturnType<typeof healthySnapshot>>(resolve => {
      resolveFirst = resolve;
    }));
    const sample = createStateMachineMonitoringSampler(60_000, collect, () => now);

    const first = sample();
    const concurrent = sample();
    expect(collect).toHaveBeenCalledTimes(1);
    resolveFirst(healthySnapshot());
    await expect(first).resolves.toMatchObject({ available: true });
    await expect(concurrent).resolves.toMatchObject({ available: true });

    now = 60_999;
    await sample();
    expect(collect).toHaveBeenCalledTimes(1);

    now = 61_000;
    const refresh = sample();
    expect(collect).toHaveBeenCalledTimes(2);
    resolveFirst(healthySnapshot());
    await refresh;
  });
});

function healthySnapshot() {
  return {
    ...emptyStateMachineMonitoringSnapshot('2026-07-16T10:00:00.000Z'),
    available: true,
  };
}

function monitoringRow(overrides: Record<string, unknown> = {}) {
  return {
    checked_at: '2026-07-16T10:00:00.000Z',
    payment_non_terminal_count: '2',
    payment_max_age_seconds: '120',
    payment_expired_leases: '1',
    payment_manual_review: '7',
    payment_field_conflicts: '1',
    refund_non_terminal_count: '3',
    refund_max_age_seconds: '240',
    refund_expired_leases: '2',
    refund_manual_review: '8',
    refund_field_conflicts: '2',
    generation_non_terminal_count: '4',
    generation_max_age_seconds: '360',
    generation_expired_leases: '3',
    generation_manual_review: '9',
    generation_field_conflicts: '3',
    upload_non_terminal_count: '5',
    upload_max_age_seconds: '480',
    upload_expired_leases: '4',
    upload_staging_orphans: '12',
    asset_thumbnail_pending: '15',
    asset_thumbnail_failed: '16',
    provider_rejected_events: '10',
    provider_rejected_events_last_24_hours: '4',
    credit_balance_mismatch_users: '11',
    object_deletion_backlog: '13',
    object_deletion_due_backlog: '14',
    object_deletion_max_age_seconds: '900',
    object_deletion_max_due_age_seconds: '600',
    object_deletion_expired_leases: '5',
    payment_notification_expired_leases: '6',
    ...overrides,
  };
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}
