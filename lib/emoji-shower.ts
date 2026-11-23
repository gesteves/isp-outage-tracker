import {
  EMOJI_SHOWER_DURATION_MS,
  EMOJI_SHOWER_FALL_MS,
  EMOJI_SHOWER_PER_SECOND,
  OUTAGE_END_EMOJI,
  OUTAGE_START_EMOJI,
} from '@/lib/config';

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
  /** When the emoji starts falling, counted from the start of the shower. */
  delayMs: number;
  sizeRem: number;
  /** Sideways drift over the fall, in px. */
  drift: number;
  /** Rotation over the fall, in degrees. */
  spin: number;
}

/** How many emoji fall in a shower of `totalMs`. */
export function showerParticleCount(totalMs: number = EMOJI_SHOWER_DURATION_MS): number {
  return Math.max(1, Math.round((EMOJI_SHOWER_PER_SECOND * totalMs) / 1000));
}

/** How long a shower of `totalMs` stays on screen: emoji keep starting until `totalMs`, then the last one lands. */
export function showerLifetimeMs(totalMs: number = EMOJI_SHOWER_DURATION_MS): number {
  return totalMs + EMOJI_SHOWER_FALL_MS;
}

const between = (random: () => number, min: number, max: number) => min + random() * (max - min);

export function createShowerParticles(
  kind: ShowerKind,
  totalMs: number = EMOJI_SHOWER_DURATION_MS,
  random: () => number = Math.random,
): ShowerParticle[] {
  const emoji = SHOWER_EMOJI[kind];
  const count = showerParticleCount(totalMs);
  // One emoji at a random point in each equal slot of the duration, so they keep
  // coming at a steady rate without gaps or clumps.
  const slotMs = totalMs / count;
  return Array.from({ length: count }, (_, id) => ({
    id,
    emoji: emoji[Math.min(emoji.length - 1, Math.floor(random() * emoji.length))],
    left: between(random, 0, 100),
    delayMs: (id + random()) * slotMs,
    sizeRem: between(random, 1.5, 3),
    drift: between(random, -40, 40),
    spin: between(random, -360, 360),
  }));
}
