import { CalendarDays,ChevronDown,ChevronLeft,ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

export type DatePickerMode = 'month' | 'date';

export interface DatePickerProps {
  mode: DatePickerMode;
  value: string;
  max: string;
  min?: string;
  onValueChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  size?: 'filter' | 'md';
}

export interface DatePickerMonthParts {
  year: number;
  month: number;
}

export interface DatePickerDateParts extends DatePickerMonthParts {
  day: number;
}

export interface DatePickerGridDay extends DatePickerDateParts {
  value: string;
  inCurrentMonth: boolean;
}

type PanelPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

const VIEWPORT_PADDING = 8;
const PANEL_GAP = 6;
const MONTH_PANEL_WIDTH = 284;
const DATE_PANEL_WIDTH = 316;
const MONTH_PANEL_HEIGHT = 272;
const DATE_PANEL_HEIGHT = 338;
const WEEKDAY_LABELS = ['一','二','三','四','五','六','日'];

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

function rowsOf<T>(values: T[], columns: number) {
  return Array.from({ length: Math.ceil(values.length / columns) }, (_,index) => (
    values.slice(index * columns, (index + 1) * columns)
  ));
}

function utcDate(year: number, month: number, day: number) {
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  return result;
}

function formatMonth(parts: DatePickerMonthParts) {
  return `${pad(parts.year, 4)}-${pad(parts.month)}`;
}

function formatDate(parts: DatePickerDateParts) {
  return `${formatMonth(parts)}-${pad(parts.day)}`;
}

function normalizeMonth(year: number, month: number): DatePickerMonthParts {
  const absoluteMonth = year * 12 + month - 1;
  const normalizedYear = Math.floor(absoluteMonth / 12);
  const normalizedMonth = ((absoluteMonth % 12) + 12) % 12 + 1;
  return { year: normalizedYear, month: normalizedMonth };
}

export function parseDatePickerMonth(value: string): DatePickerMonthParts | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function parseDatePickerDate(value: string): DatePickerDateParts | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const parsed = utcDate(parts.year, parts.month, parts.day);
  if (
    parsed.getUTCFullYear() !== parts.year
    || parsed.getUTCMonth() + 1 !== parts.month
    || parsed.getUTCDate() !== parts.day
  ) return null;
  return parts;
}

export function buildDatePickerGrid(monthValue: string): DatePickerGridDay[] {
  const month = parseDatePickerMonth(monthValue);
  if (!month) return [];
  const firstDay = utcDate(month.year, month.month, 1);
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const gridStart = utcDate(month.year, month.month, 1 - mondayOffset);

  return Array.from({ length: 42 }, (_,index) => {
    const date = new Date(gridStart.getTime());
    date.setUTCDate(gridStart.getUTCDate() + index);
    const parts = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
    return {
      ...parts,
      value: formatDate(parts),
      inCurrentMonth: parts.year === month.year && parts.month === month.month,
    };
  });
}

export function isDatePickerMonthDisabled(value: string, max: string, min = '') {
  return !parseDatePickerMonth(value)
    || (Boolean(parseDatePickerMonth(max)) && value > max)
    || (Boolean(parseDatePickerMonth(min)) && value < min);
}

export function isDatePickerDateDisabled(value: string, max: string, min = '') {
  return !parseDatePickerDate(value)
    || (Boolean(parseDatePickerDate(max)) && value > max)
    || (Boolean(parseDatePickerDate(min)) && value < min);
}

function addMonths(value: string, amount: number) {
  const parts = parseDatePickerMonth(value);
  if (!parts) return value;
  return formatMonth(normalizeMonth(parts.year, parts.month + amount));
}

function addYearsToMonth(value: string, amount: number) {
  const parts = parseDatePickerMonth(value);
  return parts ? formatMonth({ year: parts.year + amount, month: parts.month }) : value;
}

function addDays(value: string, amount: number) {
  const parts = parseDatePickerDate(value);
  if (!parts) return value;
  const date = utcDate(parts.year, parts.month, parts.day + amount);
  return formatDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

function daysInMonth(year: number, month: number) {
  return utcDate(year, month + 1, 0).getUTCDate();
}

function addMonthsToDate(value: string, amount: number) {
  const parts = parseDatePickerDate(value);
  if (!parts) return value;
  const target = normalizeMonth(parts.year, parts.month + amount);
  return formatDate({ ...target, day: Math.min(parts.day, daysInMonth(target.year, target.month)) });
}

function startOfWeek(value: string) {
  const parts = parseDatePickerDate(value);
  if (!parts) return value;
  const weekday = (utcDate(parts.year, parts.month, parts.day).getUTCDay() + 6) % 7;
  return addDays(value, -weekday);
}

function beijingToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function fallbackValue(mode: DatePickerMode, value: string, max: string, min: string) {
  if (mode === 'month') {
    if (parseDatePickerMonth(value) && !isDatePickerMonthDisabled(value, max, min)) return value;
    if (parseDatePickerMonth(min) && !isDatePickerMonthDisabled(min, max, min)) return min;
    if (parseDatePickerMonth(max)) return max;
    return beijingToday().slice(0, 7);
  }
  if (parseDatePickerDate(value) && !isDatePickerDateDisabled(value, max, min)) return value;
  if (parseDatePickerDate(min) && !isDatePickerDateDisabled(min, max, min)) return min;
  if (parseDatePickerDate(max)) return max;
  return beijingToday();
}

function clampToBounds(mode: DatePickerMode, value: string, max: string, min: string) {
  const parse = mode === 'month' ? parseDatePickerMonth : parseDatePickerDate;
  if (parse(min) && value < min) return min;
  if (parse(max) && value > max) return max;
  return value;
}

function monthLabel(value: string) {
  const parts = parseDatePickerMonth(value);
  return parts ? `${pad(parts.year, 4)}年${pad(parts.month)}月` : value;
}

export function DatePicker({
  mode,
  value,
  max,
  min = '',
  onValueChange,
  label,
  placeholder,
  disabled = false,
  error,
  size = 'md',
}: DatePickerProps) {
  const generatedId = useId();
  const triggerId = `${generatedId}-trigger`;
  const dialogId = `${generatedId}-dialog`;
  const descriptionId = `${generatedId}-description`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(() => fallbackValue(mode, value, max, min));
  const [viewMonth, setViewMonth] = useState(() => fallbackValue(mode, value, max, min).slice(0, 7));
  const [position, setPosition] = useState<PanelPosition | null>(null);

  const selectedValue = fallbackValue(mode, value, max, min);
  const hasSelectedValue = mode === 'month'
    ? Boolean(parseDatePickerMonth(value)) && !isDatePickerMonthDisabled(value, max, min)
    : Boolean(parseDatePickerDate(value)) && !isDatePickerDateDisabled(value, max, min);
  const currentDate = beijingToday();
  const currentMonth = currentDate.slice(0, 7);
  const maxMonth = mode === 'month' ? max : max.slice(0, 7);
  const minMonth = mode === 'month' ? min : min.slice(0, 7);
  const panelWidth = mode === 'month' ? MONTH_PANEL_WIDTH : DATE_PANEL_WIDTH;
  const idealPanelHeight = mode === 'month' ? MONTH_PANEL_HEIGHT : DATE_PANEL_HEIGHT;
  const viewParts = parseDatePickerMonth(viewMonth) ?? parseDatePickerMonth(maxMonth) ?? { year: 1970, month: 1 };
  const activeElementId = `${dialogId}-cell-${activeValue}`;

  const monthCells = useMemo(() => Array.from({ length: 12 }, (_,index) => (
    formatMonth({ year: viewParts.year, month: index + 1 })
  )), [viewParts.year]);
  const dateCells = useMemo(() => buildDatePickerGrid(viewMonth), [viewMonth]);

  const closePicker = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(panelWidth, Math.max(0, viewportWidth - VIEWPORT_PADDING * 2));
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      Math.max(VIEWPORT_PADDING, viewportWidth - VIEWPORT_PADDING - width),
    );
    const below = viewportHeight - rect.bottom - PANEL_GAP - VIEWPORT_PADDING;
    const above = rect.top - PANEL_GAP - VIEWPORT_PADDING;
    const openAbove = below < idealPanelHeight && above > below;
    const available = Math.max(0, openAbove ? above : below);
    const maxHeight = Math.min(idealPanelHeight, available, viewportHeight - VIEWPORT_PADDING * 2);
    setPosition(openAbove
      ? { bottom: viewportHeight - rect.top + PANEL_GAP, left, width, maxHeight }
      : { top: rect.bottom + PANEL_GAP, left, width, maxHeight });
  }, [idealPanelHeight,panelWidth]);

  const openPicker = useCallback(() => {
    if (disabled) return;
    const next = fallbackValue(mode, value, max, min);
    setActiveValue(next);
    setViewMonth(next.slice(0, 7));
    setOpen(true);
  }, [disabled,max,min,mode,value]);

  const chooseValue = useCallback((nextValue: string) => {
    const valueDisabled = mode === 'month'
      ? isDatePickerMonthDisabled(nextValue, max, min)
      : isDatePickerDateDisabled(nextValue, max, min);
    if (valueDisabled) return;
    onValueChange(nextValue);
    setActiveValue(nextValue);
    setViewMonth(nextValue.slice(0, 7));
    closePicker(true);
  }, [closePicker,max,min,mode,onValueChange]);

  const moveActiveMonth = useCallback((nextValue: string) => {
    const next = clampToBounds('month', nextValue, max, min);
    setActiveValue(next);
    setViewMonth(next);
  }, [max,min]);

  const moveActiveDate = useCallback((nextValue: string) => {
    const next = clampToBounds('date', nextValue, max, min);
    setActiveValue(next);
    setViewMonth(next.slice(0, 7));
  }, [max,min]);

  const handleOpenKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker(true);
      return;
    }
    if (event.key === 'Tab') {
      closePicker();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseValue(activeValue);
      return;
    }

    let handled = true;
    if (mode === 'month') {
      const parts = parseDatePickerMonth(activeValue) ?? parseDatePickerMonth(selectedValue)!;
      if (event.key === 'ArrowLeft') moveActiveMonth(addMonths(activeValue, -1));
      else if (event.key === 'ArrowRight') moveActiveMonth(addMonths(activeValue, 1));
      else if (event.key === 'ArrowUp') moveActiveMonth(addMonths(activeValue, -3));
      else if (event.key === 'ArrowDown') moveActiveMonth(addMonths(activeValue, 3));
      else if (event.key === 'Home') moveActiveMonth(formatMonth({ year: parts.year, month: 1 }));
      else if (event.key === 'End') moveActiveMonth(formatMonth({ year: parts.year, month: 12 }));
      else if (event.key === 'PageUp') moveActiveMonth(addYearsToMonth(activeValue, -1));
      else if (event.key === 'PageDown') moveActiveMonth(addYearsToMonth(activeValue, 1));
      else handled = false;
    } else {
      if (event.key === 'ArrowLeft') moveActiveDate(addDays(activeValue, -1));
      else if (event.key === 'ArrowRight') moveActiveDate(addDays(activeValue, 1));
      else if (event.key === 'ArrowUp') moveActiveDate(addDays(activeValue, -7));
      else if (event.key === 'ArrowDown') moveActiveDate(addDays(activeValue, 7));
      else if (event.key === 'Home') moveActiveDate(startOfWeek(activeValue));
      else if (event.key === 'End') moveActiveDate(addDays(startOfWeek(activeValue), 6));
      else if (event.key === 'PageUp') moveActiveDate(addMonthsToDate(activeValue, event.shiftKey ? -12 : -1));
      else if (event.key === 'PageDown') moveActiveDate(addMonthsToDate(activeValue, event.shiftKey ? 12 : 1));
      else handled = false;
    }
    if (handled) event.preventDefault();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        openPicker();
      }
      return;
    }
    handleOpenKeyDown(event);
  };

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open,updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handleViewportChange = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const outside = rect.bottom <= VIEWPORT_PADDING
        || rect.top >= window.innerHeight - VIEWPORT_PADDING
        || rect.right <= VIEWPORT_PADDING
        || rect.left >= window.innerWidth - VIEWPORT_PADDING;
      if (outside) closePicker();
      else updatePosition();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      closePicker();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closePicker,open,updatePosition]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(activeElementId)?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeElementId,open]);

  const changeView = (amount: number) => {
    if (mode === 'month') moveActiveMonth(addYearsToMonth(activeValue, amount));
    else moveActiveDate(addMonthsToDate(activeValue, amount));
  };

  const previousLabel = mode === 'month' ? '上一年' : '上个月';
  const nextLabel = mode === 'month' ? '下一年' : '下个月';
  const nextViewValue = mode === 'month'
    ? formatMonth({ year: viewParts.year + 1, month: 1 })
    : addMonths(viewMonth, 1);
  const nextViewDisabled = Boolean(parseDatePickerMonth(maxMonth)) && nextViewValue > maxMonth;
  const previousViewValue = mode === 'month'
    ? formatMonth({ year: viewParts.year - 1, month: 12 })
    : addMonths(viewMonth, -1);
  const previousViewDisabled = Boolean(parseDatePickerMonth(minMonth)) && previousViewValue < minMonth;

  const panel = open && position && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={panelRef}
          data-ui="date-picker-dropdown"
          className={`${triggerRef.current?.closest('.product-shell, .product-popover') ? 'product-popover' : ''} fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[#1a1a30] p-3 shadow-2xl shadow-black/50`}
          style={position}
          onKeyDown={handleOpenKeyDown}
          data-date-picker-panel={mode}
        >
          <div className="mb-3 flex h-9 items-center justify-between gap-2">
            <button
              type="button"
              tabIndex={-1}
              aria-label={previousLabel}
              aria-disabled={previousViewDisabled || undefined}
              disabled={previousViewDisabled}
              onMouseDown={event => event.preventDefault()}
              onClick={() => changeView(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold text-white">
              {mode === 'month' ? `${pad(viewParts.year, 4)}年` : monthLabel(viewMonth)}
            </p>
            <button
              type="button"
              tabIndex={-1}
              aria-label={nextLabel}
              aria-disabled={nextViewDisabled || undefined}
              disabled={nextViewDisabled}
              onMouseDown={event => event.preventDefault()}
              onClick={() => changeView(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          {mode === 'date' && (
            <div aria-hidden="true" className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAY_LABELS.map(day => <span key={day} className="py-1 text-center text-[11px] font-medium text-gray-500">{day}</span>)}
            </div>
          )}

          <div
            id={dialogId}
            role="grid"
            aria-label={mode === 'month' ? '选择月份' : '选择日期'}
            aria-rowcount={mode === 'month' ? 4 : 6}
            aria-colcount={mode === 'month' ? 3 : 7}
            className={mode === 'month' ? 'space-y-2' : 'space-y-1'}
          >
            {mode === 'month' ? rowsOf(monthCells, 3).map((row,rowIndex) => (
              <div key={`${viewParts.year}-${rowIndex}`} role="row" aria-rowindex={rowIndex + 1} className="grid grid-cols-3 gap-2">
                {row.map((monthValue,columnIndex) => {
                  const selected = hasSelectedValue && monthValue === selectedValue;
                  const active = monthValue === activeValue;
                  const current = monthValue === currentMonth;
                  const cellDisabled = isDatePickerMonthDisabled(monthValue, max, min);
                  return (
                    <button
                      key={monthValue}
                      id={`${dialogId}-cell-${monthValue}`}
                      type="button"
                      role="gridcell"
                      tabIndex={-1}
                      aria-label={monthLabel(monthValue)}
                      aria-rowindex={rowIndex + 1}
                      aria-colindex={columnIndex + 1}
                      aria-selected={selected}
                      aria-disabled={cellDisabled || undefined}
                      disabled={cellDisabled}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => chooseValue(monthValue)}
                      className={`h-10 rounded-lg border text-xs font-medium transition-colors ${
                        selected
                          ? 'border-purple-400 bg-purple-600/30 text-purple-100'
                          : active
                          ? 'border-purple-400/60 bg-white/10 text-white'
                          : current
                          ? 'border-purple-400/60 bg-transparent text-purple-200'
                          : 'border-transparent text-gray-300 hover:bg-white/10 hover:text-white'
                      } disabled:cursor-not-allowed disabled:border-transparent disabled:text-gray-600 disabled:hover:bg-transparent`}
                    >
                      {parseDatePickerMonth(monthValue)?.month}月
                    </button>
                  );
                })}
              </div>
            )) : rowsOf(dateCells, 7).map((row,rowIndex) => (
              <div key={`${viewMonth}-${rowIndex}`} role="row" aria-rowindex={rowIndex + 1} className="grid grid-cols-7 gap-1">
                {row.map((day,columnIndex) => {
                  const selected = hasSelectedValue && day.value === selectedValue;
                  const active = day.value === activeValue;
                  const current = day.value === currentDate;
                  const cellDisabled = isDatePickerDateDisabled(day.value, max, min);
                  return (
                    <button
                      key={day.value}
                      id={`${dialogId}-cell-${day.value}`}
                      type="button"
                      role="gridcell"
                      tabIndex={-1}
                      aria-label={day.value}
                      aria-rowindex={rowIndex + 1}
                      aria-colindex={columnIndex + 1}
                      aria-selected={selected}
                      aria-current={current ? 'date' : undefined}
                      aria-disabled={cellDisabled || undefined}
                      disabled={cellDisabled}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => chooseValue(day.value)}
                      className={`h-8 rounded-lg border text-xs transition-colors ${
                        selected
                          ? 'border-purple-400 bg-purple-600/30 font-semibold text-purple-100'
                          : active
                          ? 'border-purple-400/60 bg-white/10 text-white'
                          : current
                          ? 'border-purple-400/60 bg-transparent text-purple-200'
                          : day.inCurrentMonth
                          ? 'border-transparent text-gray-300 hover:bg-white/10 hover:text-white'
                          : 'border-transparent text-gray-600 hover:bg-white/10 hover:text-gray-300'
                      } disabled:cursor-not-allowed disabled:border-transparent disabled:text-gray-700 disabled:hover:bg-transparent`}
                    >
                      {day.day}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={triggerId} className="block text-xs text-gray-300">{label}</label>}
      <button
        data-ui="control"
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={label ?? (mode === 'month' ? '月份' : '日期')}
        aria-haspopup="grid"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-activedescendant={open ? activeElementId : undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => open ? closePicker() : openPicker()}
        onKeyDown={handleTriggerKeyDown}
        className={`${size === 'filter' ? 'h-9 text-xs' : 'h-10 text-sm'} flex min-w-[132px] items-center justify-between gap-2 rounded-xl border bg-white/5 px-3 text-left text-white outline-none transition-colors hover:bg-white/10 focus-visible:border-purple-400 focus-visible:ring-2 focus-visible:ring-purple-400/40 disabled:cursor-not-allowed disabled:opacity-50 ${error ? 'border-red-400/60' : open ? 'border-purple-400/60' : 'border-white/10'}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-gray-400" />
          <span className={`truncate ${!hasSelectedValue && placeholder ? 'text-gray-500' : ''}`}>
            {!hasSelectedValue && placeholder
              ? placeholder
              : mode === 'month' ? monthLabel(selectedValue) : selectedValue}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 flex-shrink-0 text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {panel}
      {error && <p id={descriptionId} role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
