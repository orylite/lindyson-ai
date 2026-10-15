import { forwardRef,useImperativeHandle,useRef,type HTMLAttributes,type MouseEvent,type ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus';

type DialogRole = 'dialog' | 'alertdialog';

interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'children'> {
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
  role?: DialogRole;
  titleId?: string;
  descriptionId?: string;
  ariaLabel?: string;
  closeOnBackdrop?: boolean;
  closeDisabled?: boolean;
  rootClassName?: string;
  panelClassName?: string;
  zIndexClass?: string;
  position?: 'fixed' | 'absolute';
  backdropBlur?: boolean;
}

export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog({
  open = true,
  onClose,
  children,
  role = 'dialog',
  titleId,
  descriptionId,
  ariaLabel,
  closeOnBackdrop = true,
  closeDisabled = false,
  rootClassName = '',
  panelClassName = '',
  zIndexClass = 'z-50',
  position = 'fixed',
  backdropBlur = true,
  className = '',
  onMouseDown,
  ...props
}, forwardedRef) {
  const panelRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => panelRef.current!, []);
  useDialogFocus(open, panelRef, onClose, closeDisabled);

  if (!open) return null;

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    onMouseDown?.(event);
    if (
      !event.defaultPrevented
      && event.target === event.currentTarget
      && closeOnBackdrop
      && !closeDisabled
    ) {
      onClose();
    }
  };

  return (
    <div
      className={`${position} inset-0 ${zIndexClass} flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6 ${backdropBlur ? 'backdrop-blur-sm' : ''} ${rootClassName}`}
      onMouseDown={handleBackdropMouseDown}
      data-dialog-root="true"
      data-backdrop-blur={backdropBlur ? 'true' : 'false'}
    >
      <div
        {...props}
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-label={ariaLabel}
        aria-busy={closeDisabled || undefined}
        tabIndex={-1}
        className={`relative w-full outline-none ${panelClassName} ${className}`}
        onMouseDown={event => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
});
