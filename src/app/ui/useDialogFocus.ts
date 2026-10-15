import { useEffect,useRef,type RefObject } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const activeDialogStack: symbol[] = [];
let previousBodyOverflow = '';

export function getNextDialogTabStopIndex(
  currentIndex: number,
  itemCount: number,
  backwards: boolean,
) {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0) return backwards ? itemCount - 1 : 0;
  if (backwards) return currentIndex === 0 ? itemCount - 1 : currentIndex - 1;
  return currentIndex === itemCount - 1 ? 0 : currentIndex + 1;
}

export function useDialogFocus(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  escapeDisabled = false,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const escapeDisabledRef = useRef(escapeDisabled);
  escapeDisabledRef.current = escapeDisabled;

  useEffect(() => {
    if (!active) return;
    const dialogId = Symbol('dialog');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    const focusable = () => [...(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      .filter(element => (
        !element.hasAttribute('disabled')
        && element.getAttribute('aria-disabled') !== 'true'
        && element.getAttribute('aria-hidden') !== 'true'
        && element.getClientRects().length > 0
      ));

    if (activeDialogStack.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    activeDialogStack.push(dialogId);
    const isTopDialog = () => activeDialogStack[activeDialogStack.length - 1] === dialogId;

    const initialFocus = container?.querySelector<HTMLElement>('[data-dialog-initial-focus]')
      ?? focusable()[0]
      ?? container;
    const initialFocusFrame = window.requestAnimationFrame(() => initialFocus?.focus({ preventScroll: true }));

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog()) return;
      if (event.key === 'Escape' && !escapeDisabledRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        container?.focus({ preventScroll: true });
        return;
      }
      const currentIndex = items.findIndex(item => item === document.activeElement);
      const nextIndex = getNextDialogTabStopIndex(currentIndex, items.length, event.shiftKey);
      const isOutside = currentIndex < 0;
      const crossesBoundary = event.shiftKey ? currentIndex <= 0 : currentIndex === items.length - 1;
      if (!isOutside && !crossesBoundary) return;
      event.preventDefault();
      items[nextIndex]?.focus();
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!isTopDialog() || !container || container.contains(event.target as Node)) return;
      (focusable()[0] ?? container).focus({ preventScroll: true });
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      window.cancelAnimationFrame(initialFocusFrame);
      const stackIndex = activeDialogStack.indexOf(dialogId);
      if (stackIndex >= 0) activeDialogStack.splice(stackIndex, 1);
      if (activeDialogStack.length === 0) document.body.style.overflow = previousBodyOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, containerRef]);
}
