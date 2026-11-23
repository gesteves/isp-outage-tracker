'use client';

import { CSSProperties, useEffect, useState } from 'react';
import { ConnectionStatus } from '@/lib/monitor';
import { EMOJI_SHOWER_FALL_MS } from '@/lib/config';
import {
  ShowerKind,
  ShowerParticle,
  createShowerParticles,
  showerLifetimeMs,
} from '@/lib/emoji-shower';

interface Burst {
  key: number;
  particles: ShowerParticle[];
}

/**
 * Only a check that saw the connection change counts. Loading mid-outage
 * (unknown → down), an outage closed by a monitoring gap (down → unknown) and the
 * first check (unknown → up) don't.
 */
function showerFor(from: ConnectionStatus, to: ConnectionStatus): ShowerKind | null {
  if (from === 'up' && to === 'down') return 'start';
  if (from === 'down' && to === 'up') return 'end';
  return null;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A burst of falling emoji when an outage starts or ends. Purely decorative. */
export default function EmojiShower({ status }: { status: ConnectionStatus }) {
  const [prevStatus, setPrevStatus] = useState(status);
  const [burst, setBurst] = useState<Burst | null>(null);

  // Reacting to the status change during render, rather than in an effect, avoids
  // rendering once with the old burst.
  if (status !== prevStatus) {
    setPrevStatus(status);
    const kind = showerFor(prevStatus, status);
    if (kind && !prefersReducedMotion()) {
      setBurst({ key: (burst?.key ?? 0) + 1, particles: createShowerParticles(kind) });
    }
  }

  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(null), showerLifetimeMs());
    return () => clearTimeout(timer);
  }, [burst]);

  if (!burst) return null;

  return (
    <div
      key={burst.key}
      aria-hidden="true"
      data-testid="emoji-shower"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {burst.particles.map(p => (
        <span
          key={p.id}
          className="emoji-shower-particle"
          style={
            {
              left: `${p.left}%`,
              fontSize: `${p.sizeRem}rem`,
              animationDelay: `${p.delayMs}ms`,
              animationDuration: `${EMOJI_SHOWER_FALL_MS}ms`,
              '--drift': `${p.drift}px`,
              '--spin': `${p.spin}deg`,
            } as CSSProperties
          }
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
