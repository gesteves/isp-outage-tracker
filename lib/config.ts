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

export const DEFAULT_EMOJI_SHOWER_DURATION_MS = 3000;
export const MIN_EMOJI_SHOWER_DURATION_MS = 100;

/** How long an emoji shower lasts, from the first emoji appearing to the last one landing. */
export const EMOJI_SHOWER_DURATION_MS = parsePositiveInt(
  process.env.NEXT_PUBLIC_EMOJI_SHOWER_DURATION_MS,
  DEFAULT_EMOJI_SHOWER_DURATION_MS,
  MIN_EMOJI_SHOWER_DURATION_MS,
);

export const DEFAULT_EMOJI_SHOWER_FALL_MS = 2000;
export const MIN_EMOJI_SHOWER_FALL_MS = 100;

/**
 * How long each emoji takes to fall from just above the screen (-10vh) to just below
 * it (110vh). They start at rest and speed up evenly, like gravity, at
 * 2 × 120vh / (fall time)²: 60vh/s² at the default 2 s. The same for every shower,
 * whatever its duration.
 */
export const EMOJI_SHOWER_FALL_MS = parsePositiveInt(
  process.env.NEXT_PUBLIC_EMOJI_SHOWER_FALL_MS,
  DEFAULT_EMOJI_SHOWER_FALL_MS,
  MIN_EMOJI_SHOWER_FALL_MS,
);

export const DEFAULT_EMOJI_SHOWER_PER_SECOND = 15;

/** How many emoji start falling each second, for as long as the shower lasts. */
export const EMOJI_SHOWER_PER_SECOND = parsePositiveInt(
  process.env.NEXT_PUBLIC_EMOJI_SHOWER_PER_SECOND,
  DEFAULT_EMOJI_SHOWER_PER_SECOND,
  1,
);

export const DEFAULT_OUTAGE_START_EMOJI: readonly string[] = Object.freeze([
  '😩', '🤬', '😱', '💀', '💩', '🫪', '😡', '😭', '🥲', '😨', '😰', '🥺', '🫠', '😑', '🫩', '😵‍💫',
]);
export const DEFAULT_OUTAGE_END_EMOJI: readonly string[] = Object.freeze([
  '😃', '😄', '😁', '🤩', '😺', '😸', '🙌', '🎉', '✨',
]);

const EMOJI_SEPARATORS = /[\s,]+/;

/**
 * Parses a list of emoji from an env var. They can be written together ("😩🤬😱") or
 * separated by spaces or commas. Falls back to `fallback` if there are none.
 * Duplicates are kept: repeating an emoji makes it show up more often.
 */
export function parseEmojiList(raw: string | undefined, fallback: readonly string[]): readonly string[] {
  if (raw === undefined) return fallback;
  let list: string[];
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    // Split by grapheme, so emoji made of several code points (😵‍💫, 👍🏽, 🇦🇷) stay whole.
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    list = Array.from(segmenter.segment(raw.split(EMOJI_SEPARATORS).join('')), s => s.segment);
  } else {
    list = raw.split(EMOJI_SEPARATORS).filter(Boolean);
  }
  return list.length > 0 ? list : fallback;
}

export const OUTAGE_START_EMOJI = parseEmojiList(
  process.env.NEXT_PUBLIC_OUTAGE_START_EMOJI,
  DEFAULT_OUTAGE_START_EMOJI,
);

export const OUTAGE_END_EMOJI = parseEmojiList(
  process.env.NEXT_PUBLIC_OUTAGE_END_EMOJI,
  DEFAULT_OUTAGE_END_EMOJI,
);
