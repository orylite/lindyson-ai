import { type ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
  gradient?: string;
  titleTone?: 'gradient' | 'solid';
  align?: 'left' | 'center';
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  action,
  gradient = 'from-green-400 to-emerald-400',
  titleTone = 'gradient',
  align = 'left',
  className = '',
}: PageHeaderProps) {
  const isCentered = align === 'center';

  return (
    <div data-ui="page-header" className={`flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start ${isCentered ? 'text-center sm:justify-center' : ''} ${className}`}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.26em] text-violet-300">{eyebrow}</p>}
        <h1 className={`mb-2 ${titleTone === 'gradient' ? `bg-gradient-to-r text-3xl font-bold sm:text-4xl ${gradient} bg-clip-text text-transparent` : 'text-[1.875rem] font-extrabold leading-tight tracking-[-0.03em] text-[#f6f3ee] sm:text-[2rem]'}`}>
          {title}
        </h1>
        {subtitle && <p className={titleTone === 'solid' ? 'max-w-2xl text-sm leading-6 text-[var(--product-text-secondary)] sm:text-base' : 'text-gray-400'}>{subtitle}</p>}
      </div>
      {action && !isCentered && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{action}</div>}
    </div>
  );
}
