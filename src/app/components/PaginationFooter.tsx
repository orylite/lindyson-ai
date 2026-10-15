import type { ReactNode } from 'react';

interface PaginationFooterProps {
  count: number;
  totalItems: number;
  totalPages?: number;
  unit?: '条' | '个' | '个素材';
  loading?: boolean;
  hideSummary?: boolean;
  stacked?: boolean;
  className?: string;
  children?: ReactNode;
  'data-ui'?: string;
}

export function PaginationFooter({
  count,
  totalItems,
  totalPages,
  unit = '条',
  loading = false,
  hideSummary = false,
  stacked = false,
  className = '',
  children,
  'data-ui': dataUi,
}: PaginationFooterProps) {
  const totalUnit = unit === '个素材' ? '个' : unit;
  const summary = totalItems > 0 && totalPages !== undefined && totalPages <= 1
    ? `共 ${totalItems} ${totalUnit}`
    : `本页 ${count} ${unit} · 共 ${totalItems} ${totalUnit}`;

  return (
    <div data-ui={dataUi} className={`pagination-footer ${className}`}>
      <div className="pagination-footer-content" data-stacked={stacked || undefined}>
        {!hideSummary && <span className="pagination-summary">{summary}{loading ? ' · 正在加载' : ''}</span>}
        {children}
      </div>
    </div>
  );
}
