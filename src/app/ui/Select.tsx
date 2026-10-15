import { Check,ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectProps<T extends string> extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange' | 'size' | 'value'> {
  value: T;
  options: Array<SelectOption<T>>;
  onValueChange: (value: T) => void;
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md' | 'filter';
  maxVisibleOptions?: number;
  dropdownMinWidth?: number;
  containerClassName?: string;
  /** 为触控密集界面提供至少 44px 的触控目标，不改变其他紧凑选择器。 */
  touchTarget?: boolean;
}

type DropdownPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

const VIEWPORT_PADDING = 8;
const DROPDOWN_GAP = 6;
const DEFAULT_MAX_VISIBLE_OPTIONS = 5;
const OPTION_HEIGHT: Record<'sm' | 'md' | 'filter', number> = { sm: 32, md: 36, filter: 36 };
const DROPDOWN_VERTICAL_CHROME = 10;
const TYPEAHEAD_RESET_MS = 600;

export function Select<T extends string>({
  value,
  options,
  onValueChange,
  label,
  hint,
  error,
  size = 'md',
  maxVisibleOptions = DEFAULT_MAX_VISIBLE_OPTIONS,
  dropdownMinWidth = 0,
  containerClassName = '',
  touchTarget = false,
  id,
  className = '',
  disabled = false,
  onClick,
  onKeyDown,
  'aria-label': ariaLabel,
  ...buttonProps
}: SelectProps<T>) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const listboxId = `${selectId}-listbox`;
  const descriptionId = `${selectId}-description`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const typeaheadBufferRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);

  const selectedIndex = useMemo(
    () => options.findIndex(option => option.value === value),
    [options,value],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const firstEnabledIndex = options.findIndex(option => !option.disabled);
  const visibleOptionCount = Math.max(1, Math.floor(maxVisibleOptions));
  const optionHeight = touchTarget ? 44 : OPTION_HEIGHT[size];
  const idealDropdownHeight = Math.min(options.length, visibleOptionCount) * optionHeight + DROPDOWN_VERTICAL_CHROME;

  const getInitialActiveIndex = useCallback(() => (
    selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabledIndex
  ), [firstEnabledIndex,options,selectedIndex]);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING * 2);
    const width = Math.min(Math.max(rect.width, dropdownMinWidth), availableWidth);
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      Math.max(VIEWPORT_PADDING, viewportWidth - VIEWPORT_PADDING - width),
    );
    const spaceBelow = viewportHeight - rect.bottom - DROPDOWN_GAP - VIEWPORT_PADDING;
    const spaceAbove = rect.top - DROPDOWN_GAP - VIEWPORT_PADDING;
    const openAbove = spaceBelow < idealDropdownHeight && spaceAbove > spaceBelow;
    const availableSpace = Math.max(0, openAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(idealDropdownHeight, availableSpace, viewportHeight - VIEWPORT_PADDING * 2);

    setDropdownPosition(openAbove
      ? {
          bottom: viewportHeight - rect.top + DROPDOWN_GAP,
          left,
          width,
          maxHeight,
        }
      : {
          top: rect.bottom + DROPDOWN_GAP,
          left,
          width,
          maxHeight,
        });
  }, [dropdownMinWidth,idealDropdownHeight]);

  const openListbox = useCallback((index = getInitialActiveIndex()) => {
    if (disabled || firstEnabledIndex < 0) return;
    setActiveIndex(index >= 0 && !options[index]?.disabled ? index : firstEnabledIndex);
    setOpen(true);
  }, [disabled,firstEnabledIndex,getInitialActiveIndex,options]);

  const closeListbox = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const selectOption = useCallback((index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setActiveIndex(index);
    closeListbox(true);
  }, [closeListbox,onValueChange,options]);

  const findEnabledIndex = useCallback((startIndex: number, direction: 1 | -1) => {
    if (firstEnabledIndex < 0) return -1;
    const baseIndex = startIndex >= 0 ? startIndex : direction === 1 ? -1 : 0;
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (baseIndex + direction * offset + options.length) % options.length;
      if (!options[index]?.disabled) return index;
    }
    return firstEnabledIndex;
  }, [firstEnabledIndex,options]);

  useLayoutEffect(() => {
    if (!open) {
      setDropdownPosition(null);
      return;
    }
    updateDropdownPosition();
  }, [open,updateDropdownPosition]);

  useEffect(() => {
    if (!open) return;

    const handleViewportChange = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const outsideViewport = rect.bottom <= VIEWPORT_PADDING
        || rect.top >= window.innerHeight - VIEWPORT_PADDING
        || rect.right <= VIEWPORT_PADDING
        || rect.left >= window.innerWidth - VIEWPORT_PADDING;
      if (outsideViewport) {
        closeListbox();
        return;
      }
      updateDropdownPosition();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listboxRef.current?.contains(target)) return;
      closeListbox();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeListbox,open,updateDropdownPosition]);

  useEffect(() => {
    if (!open) return;
    const nextActiveIndex = getInitialActiveIndex();
    if (activeIndex < 0 || !options[activeIndex] || options[activeIndex]?.disabled) setActiveIndex(nextActiveIndex);
  }, [activeIndex,getInitialActiveIndex,open,options]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeIndex,listboxId,open]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  const handleTypeahead = (key: string) => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    const nextBuffer = `${typeaheadBufferRef.current}${key.toLocaleLowerCase()}`;
    typeaheadBufferRef.current = nextBuffer;
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadBufferRef.current = '';
      typeaheadTimerRef.current = null;
    }, TYPEAHEAD_RESET_MS);

    const findMatch = (query: string) => {
      const startIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
      for (let offset = 1; offset <= options.length; offset += 1) {
        const index = (startIndex + offset + options.length) % options.length;
        const option = options[index];
        if (!option?.disabled && option.label.toLocaleLowerCase().startsWith(query)) return index;
      }
      return -1;
    };

    const matchedIndex = findMatch(nextBuffer);
    const fallbackIndex = matchedIndex < 0 && nextBuffer.length > 1
      ? findMatch(key.toLocaleLowerCase())
      : matchedIndex;
    if (fallbackIndex < 0) return;
    if (!open) openListbox(fallbackIndex);
    else setActiveIndex(fallbackIndex);
  };

  const handleTriggerClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || disabled) return;
    if (open) closeListbox();
    else openListbox();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) openListbox();
      else setActiveIndex(index => findEnabledIndex(index, direction));
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const index = event.key === 'Home'
        ? firstEnabledIndex
        : [...options].map((_, optionIndex) => optionIndex).reverse().find(optionIndex => !options[optionIndex]?.disabled) ?? -1;
      if (!open) openListbox(index);
      else setActiveIndex(index);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openListbox();
      else if (activeIndex >= 0) selectOption(activeIndex);
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeListbox(true);
      return;
    }

    if (event.key === 'Tab' && open) {
      closeListbox();
      return;
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      handleTypeahead(event.key);
    }
  };

  const dropdown = open && dropdownPosition && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={label ?? ariaLabel ?? '选择选项'}
          className={`${triggerRef.current?.closest('.product-shell, .product-popover') ? 'product-popover' : ''} fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[#1a1a30] p-1 shadow-2xl shadow-black/50`}
          style={dropdownPosition}
          data-select-dropdown="true"
          data-ui="select-dropdown"
        >
          {options.map((option,index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <button
                key={option.value}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                onMouseDown={event => event.preventDefault()}
                onClick={() => selectOption(index)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 text-left transition-colors ${
                  touchTarget
                    ? 'min-h-11 py-2.5 text-sm'
                    : size === 'sm'
                    ? 'min-h-8 py-1.5 text-xs'
                    : size === 'filter'
                    ? 'min-h-9 py-2 text-xs'
                    : 'min-h-9 py-2 text-sm'
                } ${
                  selected
                    ? 'bg-purple-600/20 text-purple-300'
                    : active
                    ? 'bg-white/10 text-white'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                } disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent`}
              >
                <span className={size === 'filter' ? 'min-w-0 whitespace-normal break-words' : 'min-w-0 truncate'}>{option.label}</span>
                {selected && <Check aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`space-y-1.5 ${containerClassName}`}>
      {label && <label htmlFor={selectId} className="block text-xs text-gray-300">{label}</label>}
      <button
        {...buttonProps}
        data-ui="control"
        ref={triggerRef}
        id={selectId}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error || hint ? descriptionId : undefined}
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={`${touchTarget ? 'h-11 text-sm' : size === 'sm' ? 'h-8 text-xs' : size === 'filter' ? 'h-9 text-xs' : 'h-10 text-sm'} flex w-full items-center justify-between gap-3 rounded-xl border bg-white/5 px-3 text-left text-white outline-none transition-colors hover:bg-white/10 focus-visible:border-purple-400 focus-visible:ring-2 focus-visible:ring-purple-400/40 disabled:cursor-not-allowed disabled:opacity-50 ${error ? 'border-red-400/60' : open ? 'border-purple-400/60' : 'border-white/10'} ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedOption ? 'text-white' : 'text-gray-500'}`}>
          {selectedOption?.label ?? '请选择'}
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 flex-shrink-0 text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {dropdown}
      {hint && !error && <p id={descriptionId} className="text-xs text-gray-400">{hint}</p>}
      {error && <p id={descriptionId} role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
