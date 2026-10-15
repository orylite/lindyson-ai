import { describe, expect, it } from 'vitest';
import {
  BILLING_TIME_ZONE,
  estimateMainPlanDates,
  getBillingDate,
} from '../src/domain/billingClock.js';

describe('计费业务日期', () => {
  it('按北京时间跨越 UTC 日期边界', () => {
    expect(BILLING_TIME_ZONE).toBe('Asia/Shanghai');
    expect(getBillingDate(new Date('2026-07-09T22:30:00.000Z'))).toBe('2026-07-10');
  });

  it('北京时间午夜前仍属于当天', () => {
    expect(getBillingDate(new Date('2026-07-09T15:59:59.999Z'))).toBe('2026-07-09');
  });

  it('月付预计日期从上海业务日起增加 30 个日历日', () => {
    expect(estimateMainPlanDates('monthly', new Date('2026-07-09T16:00:00.000Z'))).toEqual({
      estimatedPlanResetAt: '2026-08-09',
      estimatedPlanExpiresAt: '2026-08-09',
    });
  });

  it('年付预计到期日按日历年计算', () => {
    expect(estimateMainPlanDates('yearly', new Date('2026-07-09T16:00:00.000Z'))).toEqual({
      estimatedPlanResetAt: '2026-08-09',
      estimatedPlanExpiresAt: '2027-07-10',
    });
  });

  it('闰日增加一日历年时与 PostgreSQL 夹紧到二月最后一天', () => {
    expect(estimateMainPlanDates('yearly', new Date('2024-02-28T16:00:00.000Z'))).toEqual({
      estimatedPlanResetAt: '2024-03-30',
      estimatedPlanExpiresAt: '2025-02-28',
    });
  });
});
