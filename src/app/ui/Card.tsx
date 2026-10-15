import { forwardRef,type HTMLAttributes,type ReactNode } from 'react';

export type CardVariant = 'default' | 'modal' | 'dropdown' | 'raised' | 'interactive' | 'media';
export type CardAccent = 'none' | 'violet' | 'blue' | 'pink' | 'cyan' | 'slate' | 'warm' | 'orange';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  variant?: CardVariant;
  accent?: CardAccent;
  hover?: boolean;
  backdropBlur?: boolean;
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default:  'bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl',
  modal:    'bg-[#0f0f1e] border border-white/10 rounded-2xl shadow-2xl',
  dropdown: 'bg-[#1a1a30] border border-white/10 rounded-xl shadow-xl',
  raised:   "relative overflow-hidden rounded-[20px] border border-[var(--product-border-default)] bg-[var(--product-surface-raised)] shadow-[var(--product-shadow-card)] before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:content-['']",
  interactive: 'relative overflow-hidden rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] shadow-[var(--product-shadow-card)] transition-[transform,border-color,background-color,box-shadow] duration-[var(--motion-standard)] ease-[var(--motion-product-ease)] hover:-translate-y-0.5 hover:border-white/15 hover:bg-[#101017]',
  media:    "relative overflow-hidden rounded-3xl border border-[var(--product-border-default)] bg-[var(--product-surface-base)] shadow-[var(--product-shadow-floating)] before:pointer-events-none before:absolute before:inset-x-10 before:top-0 before:z-10 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent before:content-['']",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ children, className = '', variant = 'default', accent = 'none', hover = false, backdropBlur = true, ...props }, ref) {
  return (
    <div
      ref={ref}
      {...props}
      data-ui="card"
      data-variant={variant}
      data-accent={accent}
      data-backdrop-blur={backdropBlur ? 'true' : 'false'}
      className={`
        ${VARIANT_CLASSES[variant]}
        ${hover ? 'hover:border-white/20 transition-all cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
});

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between px-5 pt-5 ${className}`}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`p-5 ${className}`}>
      {children}
    </div>
  );
}
