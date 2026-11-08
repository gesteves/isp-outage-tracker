export const DEFAULT_CHECK_INTERVAL_SECONDS = 60;
export const MIN_CHECK_INTERVAL_SECONDS = 5;
export const DEFAULT_FAILURE_THRESHOLD = 2;

/**
 * Parses a positive integer from an env var, falling back to `fallback` when the
 * value is missing, malformed, or below `min`. Without this, a typo would yield
 * NaN: a NaN interval makes timers fire continuously, and a NaN threshold means
 * outages are never recorded.
 */
export function parsePositiveInt(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) return fallback;
  return value;
}

// NEXT_PUBLIC_* vars must be referenced literally so Next.js can inline them at build time.
export const CHECK_INTERVAL_MS =
  parsePositiveInt(
    process.env.NEXT_PUBLIC_CHECK_INTERVAL_SECONDS,
    DEFAULT_CHECK_INTERVAL_SECONDS,
    MIN_CHECK_INTERVAL_SECONDS,
  ) * 1000;

export const FAILURE_THRESHOLD = parsePositiveInt(
  process.env.NEXT_PUBLIC_FAILURE_THRESHOLD,
  DEFAULT_FAILURE_THRESHOLD,
  1,
);
