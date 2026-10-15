import type { AdminApiCostFilters } from './admin';

/** 为成本看盘请求生成稳定键；搜索和状态仅属于任务表。 */
export function apiCostFilterKey(
  filters: AdminApiCostFilters,
  scope: 'overview' | 'users' | 'tasks' = 'overview',
) {
  const keys = scope === 'tasks'
    ? ['range', 'month', 'date', 'from', 'to', 'model', 'resolution', 'status', 'costState', 'search'] as const
    : ['range', 'month', 'date', 'from', 'to', 'model'] as const;
  return keys.map(key => `${key}=${filters[key] ?? ''}`).join('&');
}
