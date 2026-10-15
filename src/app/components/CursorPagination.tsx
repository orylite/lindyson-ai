import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import type { ExactCursorPagination as CursorPaginationState,PagePosition } from '../api/cursor';

interface CursorPaginationProps {
  pagination: CursorPaginationState;
  loading?: boolean;
  empty?: boolean;
  onNavigate: (position: PagePosition) => void;
  label?: string;
}

interface PaginationButtonProps {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

export function CursorPagination({
  pagination,
  loading = false,
  empty = false,
  onNavigate,
  label = '列表翻页',
}: CursorPaginationProps) {
  if (empty || pagination.totalItems === 0 || pagination.totalPages <= 1) return null;

  const atFirst = !pagination.hasPrevious;
  const atLast = !pagination.hasNext;

  return (
    <nav aria-label={label} aria-busy={loading} className="pagination-navigation flex min-w-0 justify-center">
      <div
        role="group"
        className="pagination-controls"
      >
        <PaginationButton
          icon={ChevronsLeft}
          label="首页"
          disabled={loading || atFirst}
          onClick={() => onNavigate('first')}
        />
        <PaginationButton
          icon={ChevronLeft}
          label="上一页"
          disabled={loading || atFirst}
          onClick={() => onNavigate('previous')}
        />

        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`第 ${pagination.currentPage} 页，共 ${pagination.totalPages} 页`}
          className="pagination-page relative flex min-h-[32px] min-w-0 items-center justify-center px-1 text-[12px] font-medium tabular-nums"
        >
          <span aria-hidden="true" className="pagination-page-numbers">
            <span className="text-[var(--product-text-primary,#f6f3ee)]">{pagination.currentPage}</span>
            <span className="text-[var(--product-text-muted,#8b8d9e)]"> / {pagination.totalPages}</span>
          </span>
          {loading && (
            <Loader2
              aria-hidden="true"
              focusable="false"
              className="absolute -top-2 left-1/2 h-[10px] w-[10px] -translate-x-1/2 animate-spin text-violet-300 motion-reduce:animate-none"
            />
          )}
        </span>

        <PaginationButton
          icon={ChevronRight}
          label="下一页"
          disabled={loading || atLast}
          onClick={() => onNavigate('next')}
        />
        <PaginationButton
          icon={ChevronsRight}
          label="尾页"
          disabled={loading || atLast}
          onClick={() => onNavigate('last')}
        />
      </div>
    </nav>
  );
}

function PaginationButton({ icon: Icon, label, disabled, onClick }: PaginationButtonProps) {
  return (
    <span className="pagination-button-wrap group relative flex items-center justify-center">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="pagination-button inline-flex items-center justify-center rounded-[8px] border-0 bg-transparent text-gray-400 transition-[background-color,color,box-shadow] duration-150 enabled:hover:bg-violet-400/[0.10] enabled:hover:text-violet-100 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-focus,#c4b5fd)] focus-visible:ring-offset-1 focus-visible:ring-offset-[#111117] disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none"
      >
        <Icon aria-hidden="true" focusable="false" className="h-[16px] w-[16px]" strokeWidth={1.75} />
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#17171e] px-2 py-1 text-[11px] font-medium text-gray-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
      >
        {label}
      </span>
    </span>
  );
}
