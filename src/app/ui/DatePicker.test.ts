import { describe,expect,it } from 'vitest';
import {
  buildDatePickerGrid,
  isDatePickerDateDisabled,
  isDatePickerMonthDisabled,
  parseDatePickerDate,
  parseDatePickerMonth,
} from './DatePicker';

describe('DatePicker 日期解析', () => {
  it('严格解析月份和合法日期', () => {
    expect(parseDatePickerMonth('2026-07')).toEqual({ year: 2026, month: 7 });
    expect(parseDatePickerMonth('2026-13')).toBeNull();
    expect(parseDatePickerDate('2026-07-14')).toEqual({ year: 2026, month: 7, day: 14 });
    expect(parseDatePickerDate('2026-02-29')).toBeNull();
  });

  it('正确处理闰年', () => {
    expect(parseDatePickerDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDatePickerDate('2100-02-29')).toBeNull();
    expect(parseDatePickerDate('2000-02-29')).not.toBeNull();
  });
});

describe('DatePicker 固定日期网格', () => {
  it('以周一为首列并固定生成六周', () => {
    const grid = buildDatePickerGrid('2026-06');
    expect(grid).toHaveLength(42);
    expect(grid[0]?.value).toBe('2026-06-01');
    expect(grid[41]?.value).toBe('2026-07-12');
  });

  it('非周一起始月份从上月周一补齐', () => {
    const grid = buildDatePickerGrid('2026-07');
    expect(grid[0]?.value).toBe('2026-06-29');
    expect(grid[2]?.value).toBe('2026-07-01');
    expect(grid[0]?.inCurrentMonth).toBe(false);
  });

  it('跨月和跨年保留相邻月份日期', () => {
    const grid = buildDatePickerGrid('2025-12');
    expect(grid[0]?.value).toBe('2025-12-01');
    expect(grid[grid.length - 1]?.value).toBe('2026-01-11');
    expect(grid.filter(day => !day.inCurrentMonth).map(day => day.value)).toContain('2026-01-01');
  });

  it('无效月份不生成伪造网格', () => {
    expect(buildDatePickerGrid('2026-99')).toEqual([]);
  });
});

describe('DatePicker 最大值边界', () => {
  it('禁用未来月份但保留最大月份', () => {
    expect(isDatePickerMonthDisabled('2026-07', '2026-07')).toBe(false);
    expect(isDatePickerMonthDisabled('2026-08', '2026-07')).toBe(true);
    expect(isDatePickerMonthDisabled('2025-12', '2026-07')).toBe(false);
  });

  it('禁用未来日期、无效日期并保留最大日期', () => {
    expect(isDatePickerDateDisabled('2026-07-14', '2026-07-14')).toBe(false);
    expect(isDatePickerDateDisabled('2026-07-15', '2026-07-14')).toBe(true);
    expect(isDatePickerDateDisabled('2026-02-31', '2026-07-14')).toBe(true);
  });
});

describe('DatePicker 最小值边界', () => {
  it('禁用早于最小值的月份和日期', () => {
    expect(isDatePickerMonthDisabled('2026-06', '2027-12', '2026-07')).toBe(true);
    expect(isDatePickerMonthDisabled('2026-07', '2027-12', '2026-07')).toBe(false);
    expect(isDatePickerDateDisabled('2026-07-16', '2027-12-31', '2026-07-17')).toBe(true);
    expect(isDatePickerDateDisabled('2026-07-17', '2027-12-31', '2026-07-17')).toBe(false);
  });
});
