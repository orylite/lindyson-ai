export const BILLING_TIME_ZONE = 'Asia/Shanghai';

export function getBillingDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BILLING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function estimateMainPlanDates(billing: 'monthly' | 'yearly', value: Date) {
  const billingDate = getBillingDate(value);
  const resetAt = addCalendarDays(billingDate, 30);
  return {
    estimatedPlanResetAt: resetAt,
    estimatedPlanExpiresAt: billing === 'yearly'
      ? addCalendarYear(billingDate)
      : resetAt,
  };
}

function addCalendarDays(value: string, days: number) {
  const { year, month, day } = parseBillingDate(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addCalendarYear(value: string) {
  const { year, month, day } = parseBillingDate(value);
  const targetYear = year + 1;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return formatDate(targetYear, month, Math.min(day, lastDayOfTargetMonth));
}

function parseBillingDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

function formatDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
