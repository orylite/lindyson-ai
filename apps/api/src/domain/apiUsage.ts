export interface ProviderPackageSortRow {
  package_id: string;
  starts_at?: Date | string | null;
  expires_at?: Date | string | null;
  updated_at?: Date | string | null;
}

export function sortProviderPackagesBySubscription<T extends ProviderPackageSortRow>(rows: T[]) {
  return [...rows].sort((left, right) => (
    compareDateDesc(left.starts_at, right.starts_at)
    || compareDateDesc(left.expires_at, right.expires_at)
    || compareDateDesc(left.updated_at, right.updated_at)
    || right.package_id.localeCompare(left.package_id)
  ));
}

function compareDateDesc(left: Date | string | null | undefined, right: Date | string | null | undefined) {
  const leftTime = dateTime(left);
  const rightTime = dateTime(right);

  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return rightTime - leftTime;
}

function dateTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}
