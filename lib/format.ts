/**
 * Formats seconds as e.g. "1d 2h 3m 4s", omitting zero parts. `maxParts` limits the
 * output to the largest unit and the ones right below it, so "20d 22h 0m 6s" becomes
 * "20d 22h" and "30d 0h 0m 7s" becomes "30d": at that scale, seconds are noise.
 */
export function formatDurationFromSeconds(
  seconds: number,
  { maxParts = Infinity }: { maxParts?: number } = {},
): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const units: Array<[number, string]> = [[days, 'd'], [hours, 'h'], [minutes, 'm'], [secs, 's']];
  const largest = units.findIndex(([value]) => value > 0);
  if (largest === -1) return '0s';

  return units
    .slice(largest, largest + maxParts)
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ');
}

/**
 * Formats a percentage to 2 decimals, rounding *down* so any downtime at all
 * keeps it below "100.00".
 */
export function formatPercentage(value: number): string {
  // The epsilon absorbs float error (e.g. 1.13 * 100 === 112.99999999999999).
  return (Math.floor(value * 100 + 1e-9) / 100).toFixed(2);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

const formatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale?: string): Intl.RelativeTimeFormat {
  const key = locale ?? '';
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** "5 minutes ago", "yesterday", "in 2 hours", in the browser's locale unless one is given. */
export function formatTimeAgo(timestamp: string, now: number = Date.now(), locale?: string): string {
  const diffSeconds = (Date.parse(timestamp) - now) / 1000;
  const [unit, size] =
    RELATIVE_UNITS.find(([, s]) => Math.abs(diffSeconds) >= s) ?? RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  // Truncate so 90 minutes reads "1 hour ago", like a clock would, not "2 hours ago".
  const value = Math.trunc(diffSeconds / size);
  return relativeFormatter(locale).format(value === 0 ? 0 : value, unit);
}

/** Local time of day, e.g. "10:02 AM". */
export function formatClockTime(timestamp: string | number, locale?: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Local date and time with its UTC offset, e.g. "2026-11-09T08:38:46-07:00". Unlike
 * toLocaleString(), it reads the same in every locale, and the offset is the one in
 * effect at that moment, so times on either side of a DST change are both right.
 */
export function formatLocalIso(timestamp: string | number): string {
  const d = new Date(timestamp);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${date}T${time}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}
