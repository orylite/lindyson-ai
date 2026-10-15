import { type ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, icon, action, className = '' }: SectionHeaderProps) {
  return (
    <div data-ui="section-header" className={`flex items-center justify-between ${className}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {title}
      </h3>
      {action && <div>{action}</div>}
    </div>
  );
}
