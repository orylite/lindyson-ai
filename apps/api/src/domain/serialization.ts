export function toIsoDateTime(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoDate(value: Date | string | null | undefined) {
  const iso = toIsoDateTime(value);
  return iso ? iso.slice(0, 10) : null;
}

export function toInt(value: unknown) {
  return typeof value === 'number' ? value : Number(value ?? 0);
}
