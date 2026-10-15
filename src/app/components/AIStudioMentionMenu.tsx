import { motion } from 'motion/react';
import type { CSSProperties,ReactNode } from 'react';

const MENTION_MENU_PREFERRED_WIDTH = 320;
const MENTION_MENU_SIDE_INSET = 8;

const TEXTAREA_CARET_STYLE_PROPERTIES = [
  'box-sizing',
  'width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'tab-size',
  'word-break',
  'overflow-wrap',
] as const;

export interface TextareaCaretPosition {
  left: number;
  top: number;
  height: number;
}

export interface MentionMenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight?: number;
}

export interface MentionMenuOption {
  id: string;
  label: string;
  description: string;
  leading: ReactNode;
}

export interface MentionMenuGroup {
  id: string;
  label: string;
  options: MentionMenuOption[];
}

export function getMentionMenuHorizontalBounds(
  caretLeft: number,
  inputWidth: number,
  preferredWidth = MENTION_MENU_PREFERRED_WIDTH,
  sideInset = MENTION_MENU_SIDE_INSET,
) {
  const safeInputWidth = Math.max(0, inputWidth);
  const safeSideInset = Math.min(Math.max(0, sideInset), safeInputWidth / 2);
  const availableWidth = Math.max(0, safeInputWidth - safeSideInset * 2);
  const width = Math.min(Math.max(0, preferredWidth), availableWidth);
  const maximumLeft = Math.max(safeSideInset, safeInputWidth - safeSideInset - width);
  const left = Math.min(Math.max(safeSideInset, caretLeft), maximumLeft);

  return { left, width };
}

export function measureTextareaCaret(input: HTMLTextAreaElement, caret: number): TextareaCaretPosition {
  const styles = window.getComputedStyle(input);
  const mirror = document.createElement('div');

  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.position = 'fixed';
  mirror.style.left = '-9999px';
  mirror.style.top = '0';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.margin = '0';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.height = 'auto';

  TEXTAREA_CARET_STYLE_PROPERTIES.forEach((property) => {
    mirror.style.setProperty(property, styles.getPropertyValue(property));
  });
  mirror.style.overflowX = 'hidden';
  mirror.style.overflowY = input.scrollHeight > input.clientHeight ? 'scroll' : 'hidden';

  mirror.textContent = input.value.slice(0, caret);
  const marker = document.createElement('span');
  marker.textContent = input.value.slice(caret) || '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
  const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
  const fontSize = Number.parseFloat(styles.fontSize) || 14;
  const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize * 1.5;
  const position = {
    left: marker.offsetLeft + borderLeft - input.scrollLeft,
    top: marker.offsetTop + borderTop - input.scrollTop,
    height: lineHeight,
  };

  mirror.remove();
  return position;
}

export function AIStudioMentionMenu({
  groups,
  activeIndex,
  position,
  accent,
  testId,
  ariaLabel,
  emptyMessage = '没有匹配的引用',
  onActiveIndexChange,
  onSelect,
}: {
  groups: MentionMenuGroup[];
  activeIndex: number;
  position: MentionMenuPosition;
  accent: 'violet' | 'pink';
  testId: string;
  ariaLabel: string;
  emptyMessage?: string;
  onActiveIndexChange: (index: number) => void;
  onSelect: (index: number) => void;
}) {
  const options = groups.flatMap(group => group.options);
  const activeOption = options[activeIndex];
  const activeClass = accent === 'pink' ? 'bg-pink-500/15' : 'bg-violet-500/15';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      data-testid={testId}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={activeOption ? `${testId}-${activeOption.id}` : undefined}
      style={position as CSSProperties}
      className="absolute z-30 max-h-64 space-y-1 overflow-x-hidden overflow-y-auto rounded-2xl border border-white/10 bg-[var(--product-surface-floating)] p-2 shadow-2xl"
    >
      {options.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-gray-500">{emptyMessage}</p>
      ) : groups.map(group => group.options.length > 0 && (
        <div key={group.id} role="group" aria-label={group.label}>
          <p className="px-3 pb-1 pt-2 text-[10px] font-medium text-gray-500">{group.label}</p>
          {group.options.map(option => {
            const optionIndex = options.findIndex(item => item.id === option.id);
            const active = optionIndex === activeIndex;
            return (
              <button
                id={`${testId}-${option.id}`}
                key={option.id}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onActiveIndexChange(optionIndex)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(optionIndex);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${active ? activeClass : 'hover:bg-white/10'}`}
              >
                {option.leading}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{option.label}</span>
                  <span className="block truncate text-xs text-gray-500">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </motion.div>
  );
}
