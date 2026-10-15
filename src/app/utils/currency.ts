export function formatCnyFromCents(amountCents: number) {
  const safeAmount = Number.isFinite(amountCents) ? amountCents : 0;
  const amountYuan = safeAmount / 100;
  const hasFraction = Math.abs(safeAmount % 100) > 0;

  return `¥${amountYuan.toLocaleString('zh-CN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function centsToYuan(amountCents: number) {
  const safeAmount = Number.isFinite(amountCents) ? amountCents : 0;
  return Number((safeAmount / 100).toFixed(2));
}

export function yuanToCents(amountYuan: number) {
  const safeAmount = Number.isFinite(amountYuan) ? amountYuan : 0;
  return Math.round(safeAmount * 100);
}
