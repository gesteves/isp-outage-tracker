/** 'start': an outage just began. 'end': the connection just came back. */
export type ShowerKind = 'start' | 'end';

export const SHOWER_EMOJI: Record<ShowerKind, readonly string[]> = {
  start: ['😩', '🤬', '😱', '💀', '💩', '💀', '🫪', '😡', '😭', '🥲', '😨', '😰', '🥺', '🫠', '😑', '🫩', '😵‍💫'],
  end: ['😃', '😄', '😁', '🤩', '😺', '😸', '🙌', '🎉', '✨'],
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

const MAX_DELAY_MS = 1200;
const MIN_DURATION_MS = 2500;
const MAX_DURATION_MS = 4000;

/** How long a shower lasts, from the first particle appearing to the last one landing. */
export const SHOWER_MAX_MS = MAX_DELAY_MS + MAX_DURATION_MS;

export const SHOWER_PARTICLE_COUNT = 40;

const between = (random: () => number, min: number, max: number) => min + random() * (max - min);

export function createShowerParticles(
  kind: ShowerKind,
  count = SHOWER_PARTICLE_COUNT,
  random: () => number = Math.random,
): ShowerParticle[] {
  const emoji = SHOWER_EMOJI[kind];
  return Array.from({ length: count }, (_, id) => ({
    id,
    emoji: emoji[Math.min(emoji.length - 1, Math.floor(random() * emoji.length))],
    left: between(random, 0, 100),
    delayMs: between(random, 0, MAX_DELAY_MS),
    durationMs: between(random, MIN_DURATION_MS, MAX_DURATION_MS),
    sizeRem: between(random, 1.5, 3),
    drift: between(random, -40, 40),
    spin: between(random, -360, 360),
  }));
}
