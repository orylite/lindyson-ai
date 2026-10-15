import { Loader2 } from 'lucide-react';
import { forwardRef,type ButtonHTMLAttributes,type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'pink';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:   'relative overflow-hidden text-white hover:opacity-90',
  pink:      'relative overflow-hidden text-white hover:opacity-90',
  secondary: 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white',
  ghost:     'text-gray-400 hover:text-white hover:bg-white/5',
  danger:    'bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-5 py-2.5 text-sm rounded-xl',
  lg: 'px-6 py-3.5 text-sm rounded-2xl w-full',
};

const GRADIENT: Record<Variant, string | null> = {
  primary:   'bg-gradient-to-r from-purple-600 to-blue-600',
  pink:      'bg-gradient-to-r from-pink-600 to-purple-600',
  secondary: null,
  ghost:     null,
  danger:    null,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  children,
  className = '',
  disabled,
  ...props
}, ref) {
  const isDisabled = disabled || loading;
  const grad = GRADIENT[variant];

  return (
    <button
      ref={ref}
      {...props}
      data-ui="button"
      data-variant={variant}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`
        relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f1e]
        ${VARIANT_CLASSES[variant]}
        ${SIZE_CLASSES[size]}
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      {grad && <div className={`lindyson-button-gradient absolute inset-0 ${grad}`} />}
      <span className={`lindyson-button-content relative flex items-center gap-2 ${loading ? 'opacity-0' : ''}`}>
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {children}
        {iconRight && <span className="flex-shrink-0">{iconRight}</span>}
      </span>
      {loading && (
        <span className="lindyson-button-loader absolute inset-0 flex items-center justify-center">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /><span className="product-loading-copy hidden text-xs">处理中</span>
        </span>
      )}
    </button>
  );
});
