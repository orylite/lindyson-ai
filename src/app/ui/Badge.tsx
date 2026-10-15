import { type ReactNode } from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'purple' | 'pink' | 'orange' | 'blue';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  dot?: boolean;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-gray-400',
  success: 'bg-green-500/15 text-green-400',
  warning: 'bg-yellow-500/15 text-yellow-400',
  error:   'bg-red-500/15 text-red-400',
  purple:  'bg-purple-500/20 text-purple-300',
  pink:    'bg-pink-500/20 text-pink-300',
  orange:  'bg-orange-500/20 text-orange-300',
  blue:    'bg-blue-500/20 text-blue-300',
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-gray-500',
  success: 'bg-green-400',
  warning: 'bg-yellow-400 animate-pulse',
  error:   'bg-red-400',
  purple:  'bg-purple-400',
  pink:    'bg-pink-400',
  orange:  'bg-orange-400',
  blue:    'bg-blue-400',
};

export function Badge({ children, variant = 'default', className = '', dot = false }: BadgeProps) {
  return (
    <span data-ui="badge" data-variant={variant} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_CLASSES[variant]}`} />}
      {children}
    </span>
  );
}
