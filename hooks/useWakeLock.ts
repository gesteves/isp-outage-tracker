'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export interface WakeLockState {
  /** Whether this browser can keep the screen on (needs HTTPS or localhost). */
  supported: boolean;
  /** Whether the screen is being kept on right now. */
  active: boolean;
  error: string | null;
  /** Asks again, e.g. from a tap after the browser refused. */
  retry: () => void;
}

const noopSubscribe = () => () => {};
const isSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

function describeError(error: unknown): string {
  if ((error as { name?: string })?.name === 'NotAllowedError') {
    return 'The browser didn’t allow keeping the screen on (battery saver may be on).';
  }
  return 'Couldn’t keep the screen on.';
}

/**
 * Keeps the screen on while `enabled`. The browser drops the lock whenever the page
 * is hidden, so it's requested again each time the page becomes visible.
 */
export function useWakeLock(enabled: boolean): WakeLockState {
  const supported = useSyncExternalStore(noopSubscribe, isSupported, () => false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!supported || !enabled) return;

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (disposed) {
          void lock.release();
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) setActive(false);
        });
        setActive(true);
        setError(null);
      } catch (err) {
        if (!disposed) {
          setActive(false);
          setError(describeError(err));
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => {});
      // Forget a refusal once turned off (or retrying), so it doesn't show again on re-enable.
      setError(null);
    };
  }, [supported, enabled, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);

  return {
    supported,
    active: enabled && active,
    error: enabled ? error : null,
    retry,
  };
}
