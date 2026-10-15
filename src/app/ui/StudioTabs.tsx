import type { ButtonHTMLAttributes,HTMLAttributes,ReactNode } from 'react';

export type StudioTabAccent = 'violet' | 'pink' | 'blue' | 'cyan';

interface StudioTabListProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function StudioTabList({ children,className = '',...props }: StudioTabListProps) {
  return (
    <div
      role="tablist"
      data-ui="studio-tab-list"
      {...props}
      className={`inline-flex w-fit max-w-full flex-nowrap gap-1 overflow-x-auto rounded-xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-1 ${className}`}
    >
      {children}
    </div>
  );
}

interface StudioTabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  active: boolean;
  accent: StudioTabAccent;
  icon: ReactNode;
  children: ReactNode;
  density?: 'studio' | 'compact';
}

export function StudioTab({
  active,
  accent,
  icon,
  children,
  density = 'studio',
  className = '',
  ...props
}: StudioTabProps) {
  const densityClass = density === 'studio'
    ? 'min-w-[104px] px-4 py-2 text-sm sm:min-w-[112px]'
    : 'min-h-11 min-w-max px-3 py-2 text-xs';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-ui="studio-tab"
      data-accent={accent}
      data-state={active ? 'active' : 'inactive'}
      {...props}
      className={`flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-semibold ${densityClass} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
