import { describe,expect,it } from 'vitest';
import { formatBeijingDateTime } from './beijingTime';

describe('formatBeijingDateTime', () => {
  it('把 UTC ISO 时间转换成北京时间', () => {
    expect(formatBeijingDateTime('2026-07-01T17:02:56.667Z')).toBe('2026-07-02 01:02:56');
    expect(formatBeijingDateTime('2026-06-30T16:34:45.000Z')).toBe('2026-07-01 00:34:45');
  });

  it('保留无时区的北京时间墙上时间并补齐秒', () => {
    expect(formatBeijingDateTime('2026-06-20 00:43')).toBe('2026-06-20 00:43:00');
  });

  it('空值和非法值安全显示为占位符', () => {
    expect(formatBeijingDateTime('-')).toBe('-');
    expect(formatBeijingDateTime('')).toBe('-');
    expect(formatBeijingDateTime(null)).toBe('-');
    expect(formatBeijingDateTime('not-a-date')).toBe('-');
  });
});
