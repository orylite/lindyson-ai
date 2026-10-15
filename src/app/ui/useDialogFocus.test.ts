import { describe,expect,it } from 'vitest';
import { getNextDialogTabStopIndex } from './useDialogFocus';

describe('对话框焦点循环', () => {
  it('正向与反向越界时回到另一端', () => {
    expect(getNextDialogTabStopIndex(2, 3, false)).toBe(0);
    expect(getNextDialogTabStopIndex(0, 3, true)).toBe(2);
  });

  it('焦点位于对话框外时选择正确入口', () => {
    expect(getNextDialogTabStopIndex(-1, 3, false)).toBe(0);
    expect(getNextDialogTabStopIndex(-1, 3, true)).toBe(2);
    expect(getNextDialogTabStopIndex(-1, 0, false)).toBe(-1);
  });
});
