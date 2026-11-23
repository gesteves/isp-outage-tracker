import { EMOJI_SHOWER_DURATION_MS, OUTAGE_END_EMOJI, OUTAGE_START_EMOJI } from '@/lib/config';

/** 'start': an outage just began. 'end': the connection just came back. */
export type ShowerKind = 'start' | 'end';

export const SHOWER_EMOJI: Record<ShowerKind, readonly string[]> = {
  start: OUTAGE_START_EMOJI,
  end: OUTAGE_END_EMOJI,
};

export interface ShowerParticle {
  id: number;
  emoji: string;
  /** Horizontal start position, as a percentage of the viewport width. */
  left: number;
  delayMs: number;
  durationMs: number;
  sizeRem: number;
  /** Sideways drift over the fall, in px. */
  drift: number;
  /** Rotation over the fall, in degrees. */
  spin: number;
}

/*
 * Timings are shares of the shower's total duration: each emoji starts within the
 * first 30% of it and falls for 60–70% of it, so all have landed by the end.
 */
const MAX_DELAY_SHARE = 0.3;
const MIN_FALL_SHARE = 0.6;
const MAX_FALL_SHARE = 0.7;

export const SHOWER_PARTICLE_COUNT = 40;

const between = (random: () => number, min: number, max: number) => min + random() * (max - min);

export function createShowerParticles(
  kind: ShowerKind,
  count = SHOWER_PARTICLE_COUNT,
  random: () => number = Math.random,
  totalMs: number = EMOJI_SHOWER_DURATION_MS,
): ShowerParticle[] {
  const emoji = SHOWER_EMOJI[kind];
  return Array.from({ length: count }, (_, id) => ({
    id,
    emoji: emoji[Math.min(emoji.length - 1, Math.floor(random() * emoji.length))],
    left: between(random, 0, 100),
    delayMs: between(random, 0, MAX_DELAY_SHARE * totalMs),
    durationMs: between(random, MIN_FALL_SHARE * totalMs, MAX_FALL_SHARE * totalMs),
    sizeRem: between(random, 1.5, 3),
    drift: between(random, -40, 40),
    spin: between(random, -360, 360),
  }));
}
