const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const BEIJING_OFFSET = '+08:00';

const beijingFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatBeijingDateTime(value: unknown) {
  const date = parseDateTime(value);
  if (!date) return '-';

  const parts = Object.fromEntries(
    beijingFormatter.formatToParts(date).map(part => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function parseDateTime(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return validDate(value);
  if (typeof value === 'number') return validDate(new Date(value));
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') return null;

  const beijingLocal = parseBeijingLocalDateTime(trimmed);
  if (beijingLocal) return beijingLocal;

  return validDate(new Date(trimmed));
}

function parseBeijingLocalDateTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
  if (!match) return null;

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  return validDate(new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${BEIJING_OFFSET}`));
}

function validDate(date: Date) {
  return Number.isNaN(date.getTime()) ? null : date;
}
