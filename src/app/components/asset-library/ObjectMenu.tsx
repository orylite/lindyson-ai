import { Ellipsis } from 'lucide-react';
import { useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties,type KeyboardEvent,type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ObjectMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface ObjectMenuProps {
  label: string;
  items: ObjectMenuItem[];
  align?: 'left' | 'right';
  variant?: 'media' | 'transparent';
  className?: string;
}

const MENU_WIDTH = 176;
const MENU_VIEWPORT_MARGIN = 8;
const INITIAL_MENU_STYLE: CSSProperties = {
  position: 'fixed',
  width: MENU_WIDTH,
  maxWidth: `calc(100vw - ${MENU_VIEWPORT_MARGIN * 2}px)`,
  visibility: 'hidden',
  zIndex: 100,
};

export function ObjectMenu({ label,items,align = 'right',variant = 'media',className = '' }: ObjectMenuProps) {
  const [open,setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuStyle,setMenuStyle] = useState<CSSProperties>(() => ({ ...INITIAL_MENU_STYLE }));
  const returnFocusOnCloseRef = useRef(false);
  // 若菜单从对话框内打开，将浮层挂到该对话框面板。这既避免卡片裁切，
  // 又让菜单项仍属于 aria-modal 的焦点陷阱；页面内菜单仍挂到 body。
  const portalTarget = typeof document === 'undefined'
    ? null
    : buttonRef.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? document.body;

  const enabledItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);

  const openAndFocus = (position: 'first' | 'last' = 'first') => {
    setMenuStyle({ ...INITIAL_MENU_STYLE });
    setOpen(true);
    window.requestAnimationFrame(() => {
      const buttons = enabledItems();
      (position === 'last' ? buttons[buttons.length - 1] : buttons[0])?.focus();
    });
  };

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, [open]);

  useEffect(() => {
    if (open || !returnFocusOnCloseRef.current) return;
    returnFocusOnCloseRef.current = false;
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const positionMenu = () => {
      const trigger = buttonRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(MENU_WIDTH,Math.max(0,window.innerWidth - MENU_VIEWPORT_MARGIN * 2));
      const preferredLeft = align === 'right' ? trigger.right - width : trigger.left;
      const maxLeft = Math.max(MENU_VIEWPORT_MARGIN,window.innerWidth - width - MENU_VIEWPORT_MARGIN);
      const left = Math.min(Math.max(MENU_VIEWPORT_MARGIN,preferredLeft),maxLeft);
      const belowTop = trigger.bottom + 6;
      const top = menu && belowTop + menu.height > window.innerHeight - MENU_VIEWPORT_MARGIN
        ? Math.max(MENU_VIEWPORT_MARGIN,trigger.top - menu.height - 6)
        : belowTop;
      setMenuStyle({
        ...INITIAL_MENU_STYLE,
        left,
        top,
        width,
        visibility: 'visible',
      });
    };
    positionMenu();
    window.addEventListener('resize',positionMenu);
    window.addEventListener('scroll',positionMenu,true);
    return () => {
      window.removeEventListener('resize',positionMenu);
      window.removeEventListener('scroll',positionMenu,true);
    };
  }, [align,open]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAndFocus('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAndFocus('last');
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = enabledItems();
    const currentIndex = buttons.findIndex(button => button === document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + buttons.length) % buttons.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      returnFocusOnCloseRef.current = true;
      setOpen(false);
      return;
    } else if (event.key === 'Tab') {
      setOpen(false);
      return;
    } else {
      return;
    }
    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={event => {
          event.stopPropagation();
          if (open) {
            returnFocusOnCloseRef.current = true;
            setOpen(false);
            return;
          }
          setMenuStyle({ ...INITIAL_MENU_STYLE });
          setOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${variant === 'transparent' ? 'border-0 bg-transparent hover:bg-transparent' : 'product-media-surface border border-white/15 bg-black/75 shadow-lg shadow-black/30 hover:bg-black'}`}
      >
        <Ellipsis className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && portalTarget && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onClick={event => event.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
          style={menuStyle}
          className={`${buttonRef.current?.closest('.product-shell, .product-popover') ? 'product-popover' : ''} overflow-hidden rounded-xl border border-white/15 bg-[#181823] p-1.5 shadow-2xl shadow-black/60`}
        >
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 disabled:cursor-not-allowed disabled:opacity-45 ${item.danger ? 'text-red-300 hover:bg-red-500/15' : 'text-gray-200 hover:bg-white/10'}`}
            >
              {item.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        portalTarget,
      )}
    </div>
  );
}
