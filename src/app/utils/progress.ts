export function getSafePercent(value: number, total: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const safeTotal = Number.isFinite(total) ? total : 0;

  if (safeTotal <= 0) return 0;

  const boundedValue = Math.min(Math.max(safeValue, 0), safeTotal);
  return Math.floor((boundedValue / safeTotal) * 100);
}
