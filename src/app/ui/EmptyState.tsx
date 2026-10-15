import { type ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, subtitle, action, className = '' }: EmptyStateProps) {
  return (
    <div data-ui="empty-state" className={`flex flex-col items-center justify-center py-16 text-gray-500 ${className}`}>
      <div className="mb-3 opacity-35">{icon}</div>
      <p className="text-sm font-medium text-[var(--product-text-secondary)]">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-[var(--product-text-muted)]">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
