import {
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { AIStudioGenerateStatus } from './AIStudioGenerateFeedback';

export type AIStudioControlTone = 'video' | 'image';

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface UseAIStudioCompactMenusOptions<MenuId extends string> {
  widths: Record<MenuId, number>;
  heightEstimates: Record<MenuId, number>;
  contentKey: string;
  onMenuOpen?: () => void;
}

const VIEWPORT_INSET = 8;
const MENU_GAP = 8;

function menuPositionsEqual(current: MenuPosition | null, next: MenuPosition) {
  if (!current) return false;
  const closeEnough = (left: number | undefined, right: number | undefined) => (
    left === right || (left !== undefined && right !== undefined && Math.abs(left - right) <= 0.5)
  );
  return closeEnough(current.top, next.top)
    && closeEnough(current.bottom, next.bottom)
    && closeEnough(current.left, next.left)
    && closeEnough(current.width, next.width)
    && closeEnough(current.maxHeight, next.maxHeight);
}

export function useAIStudioCompactMenus<MenuId extends string>({
  widths,
  heightEstimates,
  contentKey,
  onMenuOpen,
}: UseAIStudioCompactMenusOptions<MenuId>) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    const menuToFocus = openMenu;
    setOpenMenu(null);
    setMenuPosition(null);
    if (restoreFocus && menuToFocus) {
      window.requestAnimationFrame(() => triggerRefs.current[menuToFocus]?.focus({ preventScroll: true }));
    }
  }, [openMenu]);

  const updateMenuPosition = useCallback(() => {
    if (!openMenu) return;
    const trigger = triggerRefs.current[openMenu];
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const availableWidth = Math.max(0, window.innerWidth - VIEWPORT_INSET * 2);
    const width = Math.min(widths[openMenu], availableWidth);
    const panel = panelRef.current;
    const panelBorderHeight = panel ? Math.max(0, panel.offsetHeight - panel.clientHeight) : 0;
    const measuredHeight = panel ? panel.scrollHeight + panelBorderHeight : 0;
    const expectedHeight = Math.ceil(measuredHeight > 0 ? measuredHeight : heightEstimates[openMenu]);
    const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - MENU_GAP - VIEWPORT_INSET);
    const spaceAbove = Math.max(0, triggerRect.top - MENU_GAP - VIEWPORT_INSET);
    const belowFits = spaceBelow >= expectedHeight;
    const aboveFits = spaceAbove >= expectedHeight;
    const openAbove = belowFits ? false : aboveFits || spaceAbove > spaceBelow;
    const availableHeight = openAbove ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(
      0,
      Math.floor(Math.min(expectedHeight, availableHeight, window.innerHeight - VIEWPORT_INSET * 2)),
    );
    const left = Math.min(
      Math.max(VIEWPORT_INSET, triggerRect.left),
      Math.max(VIEWPORT_INSET, window.innerWidth - VIEWPORT_INSET - width),
    );

    const nextPosition: MenuPosition = openAbove
      ? { bottom: window.innerHeight - triggerRect.top + MENU_GAP, left, width, maxHeight }
      : { top: triggerRect.bottom + MENU_GAP, left, width, maxHeight };
    setMenuPosition(current => menuPositionsEqual(current, nextPosition) ? current : nextPosition);
  }, [heightEstimates, openMenu, widths]);

  useLayoutEffect(() => {
    if (!openMenu) return;
    updateMenuPosition();
    const frame = window.requestAnimationFrame(updateMenuPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [contentKey, openMenu, updateMenuPosition]);

  useEffect(() => {
    if (!openMenu) return;

    const isWithinControls = (target: Node) => (
      panelRef.current?.contains(target)
      || Object.values(triggerRefs.current).some(trigger => (
        (trigger as HTMLButtonElement | null | undefined)?.contains(target)
      ))
    );
    const handlePointerDown = (event: PointerEvent) => {
      if (!isWithinControls(event.target as Node)) closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!isWithinControls(event.target as Node)) closeMenu();
    };
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      const trigger = triggerRefs.current[openMenu];
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const outsideViewport = rect.bottom <= VIEWPORT_INSET
        || rect.top >= window.innerHeight - VIEWPORT_INSET
        || rect.right <= VIEWPORT_INSET
        || rect.left >= window.innerWidth - VIEWPORT_INSET;
      if (outsideViewport) closeMenu();
      else updateMenuPosition();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeMenu, openMenu, updateMenuPosition]);

  useEffect(() => {
    if (!openMenu || !menuPosition) return;
    const frame = window.requestAnimationFrame(() => {
      // 定位、窗口缩放或内容加载不能覆盖用户已经移入菜单的键盘焦点。
      if (panelRef.current?.contains(document.activeElement)) return;
      const selected = panelRef.current?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled), [aria-checked="true"]:not(:disabled)');
      const firstControl = panelRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
      (selected ?? firstControl)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuPosition, openMenu]);

  const toggleMenu = (menu: MenuId) => {
    if (openMenu === menu) {
      closeMenu(true);
      return;
    }
    onMenuOpen?.();
    setMenuPosition(null);
    setOpenMenu(menu);
  };

  const setTriggerRef = (menu: MenuId, element: HTMLButtonElement | null) => {
    triggerRefs.current[menu] = element;
  };

  return {
    closeMenu,
    menuPosition,
    openMenu,
    panelRef,
    setTriggerRef,
    toggleMenu,
  };
}

export function AIStudioCompactMenuPortal({
  id,
  testId,
  dataUi = 'ai-studio-compact-menu',
  panelRef,
  position,
  role,
  label,
  onKeyDown,
  children,
}: {
  id: string;
  testId: string;
  dataUi?: string;
  panelRef: RefObject<HTMLDivElement>;
  position: MenuPosition | null;
  role: 'dialog' | 'listbox';
  label: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  if (!position || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      data-testid={testId}
      data-ui={dataUi}
      role={role}
      aria-label={label}
      className="product-popover fixed z-[100] overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#151521] p-2 shadow-2xl shadow-black/60"
      style={position}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}

const CONTROL_TONE_CLASSES: Record<AIStudioControlTone, {
  focus: string;
  open: string;
  icon: string;
}> = {
  video: {
    focus: 'focus-visible:border-purple-400 focus-visible:ring-purple-400/40',
    open: 'border-purple-400/60 bg-purple-500/10 text-white',
    icon: 'text-violet-300',
  },
  image: {
    focus: 'focus-visible:border-pink-400 focus-visible:ring-pink-400/40',
    open: 'border-pink-400/60 bg-pink-500/10 text-white',
    icon: 'text-pink-300',
  },
};

export function AIStudioCompactTrigger({
  idPrefix,
  menu,
  label,
  value,
  title,
  icon: Icon,
  popup = 'listbox',
  tone,
  open,
  onClick,
  setRef,
  valueDisplay = 'truncate',
  className = '',
}: {
  idPrefix: string;
  menu: string;
  label: string;
  value: string;
  title?: string;
  icon: LucideIcon;
  popup?: 'dialog' | 'listbox';
  tone: AIStudioControlTone;
  open: boolean;
  onClick: () => void;
  setRef: (element: HTMLButtonElement | null) => void;
  valueDisplay?: 'truncate' | 'full';
  className?: string;
}) {
  const toneClasses = CONTROL_TONE_CLASSES[tone];
  const showFullValue = valueDisplay === 'full';
  return (
    <button
      ref={setRef}
      type="button"
      data-ui="button"
      data-variant="secondary"
      aria-label={`${label}：${value}`}
      aria-haspopup={popup}
      aria-expanded={open}
      aria-controls={`${idPrefix}-${menu}-menu`}
      onClick={onClick}
      className={`flex min-w-0 items-center rounded-xl border text-left text-sm outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 ${showFullValue ? 'min-h-11 max-w-full gap-1.5 px-2 py-2 sm:flex-none xl:h-11 xl:py-0' : 'h-11 gap-2 px-3 sm:flex-1'} ${toneClasses.focus} ${open ? toneClasses.open : 'border-white/10 bg-white/5 text-gray-300'} ${className}`}
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 flex-shrink-0 ${toneClasses.icon}`} />
      <span className={`min-w-0 flex-1 font-medium ${showFullValue ? 'whitespace-normal break-words xl:whitespace-nowrap' : 'truncate'}`} title={title ?? value}>{value}</span>
      <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

export function AIStudioCompactMenuTitle({ children }: { children: string }) {
  return <p role="presentation" className="px-3 pb-1.5 pt-2 text-[11px] font-medium text-gray-500">{children}</p>;
}

export function AIStudioCompactMenuOption({
  selected,
  label,
  description,
  badge,
  icon: Icon,
  tone,
  disabled = false,
  onClick,
}: {
  selected: boolean;
  label: string;
  description?: string;
  badge?: string;
  icon?: LucideIcon;
  tone: AIStudioControlTone;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isImage = tone === 'image';
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isImage ? 'focus-visible:ring-pink-400/50' : 'focus-visible:ring-purple-400/50'} focus-visible:ring-2 ${selected ? (isImage ? 'bg-pink-500/15 text-white' : 'bg-purple-500/15 text-white') : 'text-gray-300 hover:bg-white/[0.06] hover:text-white'}`}
    >
      <span className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${isImage ? 'bg-gradient-to-br from-pink-600 to-purple-600' : 'bg-gradient-to-br from-purple-600 to-blue-600'}`}>
            <Icon aria-hidden="true" className="h-4 w-4 text-white" />
          </span>
        )}
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="block break-words text-sm font-medium">{label}</span>
            {badge && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${isImage ? 'bg-pink-500/15 text-pink-300' : 'bg-violet-500/15 text-violet-300'}`}>
                {badge}
              </span>
            )}
          </span>
          {description && <span className="mt-0.5 block break-words text-xs leading-5 text-gray-500">{description}</span>}
        </span>
      </span>
      {selected && <Check aria-hidden="true" className={`h-4 w-4 flex-shrink-0 ${isImage ? 'text-pink-300' : 'text-violet-300'}`} />}
    </button>
  );
}

export function AIStudioCompactParameterGroup({
  label,
  columns = 3,
  children,
}: {
  label: string;
  columns?: 2 | 3 | 4;
  children: ReactNode;
}) {
  const gridColumns = columns === 2 ? 'grid-cols-2' : columns === 4 ? 'grid-cols-4' : 'grid-cols-3';
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-gray-400">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className={`grid ${gridColumns} gap-2`}
        onKeyDown={handleRadioGroupKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

export function AIStudioCompactParameterOption({
  selected,
  tone,
  onClick,
  visual,
  children,
}: {
  selected: boolean;
  tone: AIStudioControlTone;
  onClick: () => void;
  visual?: ReactNode;
  children: ReactNode;
}) {
  const isImage = tone === 'image';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      className={`${visual ? 'h-12 px-1' : 'h-9'} rounded-xl border text-xs font-medium outline-none transition-colors focus-visible:ring-2 ${isImage ? 'focus-visible:ring-pink-400/50' : 'focus-visible:ring-purple-400/50'} ${selected ? (isImage ? 'border-pink-400/60 bg-pink-600 text-white' : 'border-purple-400/60 bg-purple-600 text-white') : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white'}`}
    >
      {visual ? (
        <span className="flex h-full flex-col items-center justify-center gap-1">
          {visual}
          <span className="leading-none">{children}</span>
        </span>
      ) : children}
    </button>
  );
}

export interface AIStudioAspectRatioOption<Value extends string> {
  value: Value;
  label: string;
  adaptive?: boolean;
}

export interface AIStudioAspectRatioFrameSize {
  width: number;
  height: number;
}

export function getAIStudioAspectRatioFrameSize(
  value: string,
  maxWidth: number,
  maxHeight: number,
): AIStudioAspectRatioFrameSize | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return null;
  }

  const ratio = widthRatio / heightRatio;
  const width = Math.min(maxWidth, maxHeight * ratio);
  const height = width / ratio;
  return {
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
  };
}

export function AIStudioCompactAspectRatioPicker<Value extends string>({
  value,
  options,
  tone,
  columns = 2,
  testIdPrefix,
  onChange,
}: {
  value: Value;
  options: readonly AIStudioAspectRatioOption<Value>[];
  tone: AIStudioControlTone;
  columns?: 2 | 3 | 4;
  testIdPrefix: string;
  onChange: (value: Value) => void;
}) {
  const selectedOption = options.find(option => option.value === value) ?? options[0];
  const isAdaptive = selectedOption?.adaptive === true;
  const frameSize = isAdaptive ? null : getAIStudioAspectRatioFrameSize(selectedOption?.value ?? '', 136, 62);
  const isImage = tone === 'image';
  const toneClasses = isImage
    ? 'border-pink-400/80 bg-gradient-to-br from-pink-500/20 to-purple-500/5 shadow-[0_0_28px_rgba(236,72,153,0.16)]'
    : 'border-purple-400/80 bg-gradient-to-br from-purple-500/20 to-blue-500/5 shadow-[0_0_28px_rgba(168,85,247,0.16)]';
  const adaptiveToneClass = isImage ? 'border-pink-400/75' : 'border-purple-400/75';

  return (
    <div className="space-y-3" data-ui="ai-studio-aspect-ratio-picker">
      <div
        aria-hidden="true"
        data-testid={`${testIdPrefix}-aspect-ratio-preview`}
        data-aspect-ratio={selectedOption?.value}
        className="relative flex h-20 items-center justify-center overflow-hidden rounded-xl border border-white/[0.07] bg-black/20"
      >
        <span className={`absolute inset-0 ${isImage ? 'bg-[radial-gradient(circle_at_center,rgba(236,72,153,0.08),transparent_64%)]' : 'bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.08),transparent_64%)]'}`} />
        {isAdaptive ? (
          <span
            data-ui="ai-studio-aspect-ratio-adaptive-frame"
            data-aspect-ratio="adaptive"
            className="relative h-[62px] w-[104px]"
          >
            <span className={`absolute left-1/2 top-0 h-[62px] w-[35px] -translate-x-1/2 rounded-md border-2 border-dashed ${adaptiveToneClass}`} />
            <span className={`absolute left-0 top-1/2 h-[35px] w-[104px] -translate-y-1/2 rounded-md border-2 border-dashed ${adaptiveToneClass}`} />
          </span>
        ) : frameSize ? (
          <span
            data-ui="ai-studio-aspect-ratio-frame"
            data-aspect-ratio={selectedOption?.value}
            className={`relative rounded-lg border-2 transition-[width,height,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${toneClasses}`}
            style={{ width: frameSize.width, height: frameSize.height }}
          >
            <span className="absolute inset-1.5 rounded border border-white/10" />
          </span>
        ) : null}
        <span className="absolute bottom-2 right-2 rounded-md bg-black/30 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
          {selectedOption?.label}
        </span>
      </div>

      <AIStudioCompactParameterGroup label="画面比例" columns={columns}>
        {options.map(option => (
          <AIStudioCompactParameterOption
            key={option.value}
            tone={tone}
            selected={value === option.value}
            onClick={() => onChange(option.value)}
            visual={<AspectRatioThumbnail value={option.value} adaptive={option.adaptive === true} />}
          >
            {option.label}
          </AIStudioCompactParameterOption>
        ))}
      </AIStudioCompactParameterGroup>
    </div>
  );
}

function AspectRatioThumbnail({ value, adaptive }: { value: string; adaptive: boolean }) {
  const frameSize = adaptive ? null : getAIStudioAspectRatioFrameSize(value, 28, 18);
  return (
    <span
      aria-hidden="true"
      data-ui="ai-studio-aspect-ratio-thumbnail"
      data-aspect-ratio={value}
      className="relative flex h-[18px] w-7 items-center justify-center"
    >
      {adaptive ? (
        <span className="relative h-[18px] w-7">
          <span className="absolute left-1/2 top-0 h-[18px] w-[10px] -translate-x-1/2 rounded-[2px] border border-dashed border-current opacity-80" />
          <span className="absolute left-0 top-1/2 h-[10px] w-7 -translate-y-1/2 rounded-[2px] border border-dashed border-current opacity-80" />
        </span>
      ) : frameSize ? (
        <span
          className="rounded-[2px] border border-current opacity-80"
          style={{ width: frameSize.width, height: frameSize.height }}
        />
      ) : null}
    </span>
  );
}

export function AIStudioCompactGenerateButton({
  tone,
  label,
  status,
  disabled,
  title,
  onClick,
}: {
  tone: AIStudioControlTone;
  label: string;
  status: AIStudioGenerateStatus;
  disabled: boolean;
  title?: string;
  onClick: () => void;
}) {
  const idleLabel = useRef(label);
  if (status === 'idle') idleLabel.current = label;
  const isSubmitting = status === 'submitting';
  const isQueued = status === 'queued';
  return (
    <button
      type="button"
      data-testid={`ai-studio-${tone}-generate-button`}
      data-ui="button"
      data-variant="primary"
      data-generate-state={status}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-busy={isSubmitting || undefined}
      className={`relative col-span-2 grid h-11 min-w-[168px] items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-semibold text-white shadow-lg transition-[filter,transform,opacity] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed sm:ml-auto ${isQueued ? 'shadow-emerald-500/20 disabled:opacity-100' : `${tone === 'image' ? 'shadow-pink-500/15' : 'shadow-purple-500/15'} disabled:opacity-60`}`}
    >
      <span className={`lindyson-button-gradient absolute inset-0 bg-gradient-to-r ${isQueued ? 'from-emerald-500 to-teal-500' : tone === 'image' ? 'from-pink-600 to-purple-600' : 'from-purple-600 to-blue-600'}`} />
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 flex items-center gap-2 whitespace-nowrap"><Sparkles className="h-4 w-4" />{idleLabel.current}</span>
      <span aria-live="polite" className="relative col-start-1 row-start-1 flex items-center justify-center gap-2 whitespace-nowrap">
        {isSubmitting
          ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          : isQueued
            ? null
            : <Sparkles aria-hidden="true" className="h-4 w-4" />}
        {label}
      </span>
    </button>
  );
}

export function AIStudioCompactRechargeLink({
  tone,
  label = '充值 / 查看套餐',
  onClick,
}: {
  tone: AIStudioControlTone;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`col-span-2 text-center text-xs font-semibold underline underline-offset-4 sm:ml-auto ${tone === 'image' ? 'text-pink-300 decoration-pink-400/40 hover:text-pink-200' : 'text-violet-300 decoration-violet-400/40 hover:text-violet-200'}`}
    >
      {label}
    </button>
  );
}

export function handleListboxMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'));
  if (!options.length) return;
  event.preventDefault();
  const currentIndex = options.findIndex(option => option === document.activeElement);
  if (event.key === 'Home') {
    options[0]?.focus();
    return;
  }
  if (event.key === 'End') {
    options[options.length - 1]?.focus();
    return;
  }
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + direction + options.length) % options.length;
  options[nextIndex]?.focus();
}

function handleRadioGroupKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  if (!options.length) return;
  event.preventDefault();
  const currentIndex = options.findIndex(option => option === document.activeElement);
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? options.length - 1
      : currentIndex < 0
        ? 0
        : (currentIndex + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  const next = options[nextIndex];
  next?.focus();
  next?.click();
}
