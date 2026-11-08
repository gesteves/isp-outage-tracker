/**
 * Elects one tab to run connectivity checks and lets tabs message each other.
 *
 * The leader holds a Web Lock for as long as it's monitoring. When its tab closes,
 * the browser releases the lock and the next waiting tab takes over. If the leader
 * stops running without closing (e.g. a suspended background tab), a waiting tab can
 * take the lock over; the old leader is told it lost it when it runs again. Tabs talk
 * over a BroadcastChannel. Where either API is missing (older browsers, plain-http
 * LAN addresses), every tab leads on its own, which is how the app worked before.
 */

export type TabMessage<S> =
  | { type: 'snapshot'; snapshot: S }
  | { type: 'hello' }
  | { type: 'clear' }
  | { type: 'checkNow' }
  | { type: 'deleteOutage'; id: string }
  | { type: 'flagOutage'; id: string; flagged: boolean };

export interface LeadershipCallbacks {
  /** This tab is now the leader. */
  onAcquired: () => void;
  /** Another tab took leadership over. This tab waits in line to lead again. */
  onLost: () => void;
}

export interface Leadership {
  /** Gives up leadership, or cancels the request if it hasn't been granted yet. */
  release: () => void;
  /** Takes the lock from a leader that holds it but has stopped responding. */
  takeOver: () => void;
}

export interface TabCoordinator<S> {
  /** False when tabs can't coordinate and every tab leads. */
  readonly shared: boolean;
  requestLeadership: (callbacks: LeadershipCallbacks) => Leadership;
  post: (message: TabMessage<S>) => void;
  onMessage: (listener: (message: TabMessage<S>) => void) => () => void;
}

export const LOCK_NAME = 'isp-outage-tracker-monitor';
export const CHANNEL_NAME = 'isp-outage-tracker';

export function soloCoordinator<S>(): TabCoordinator<S> {
  return {
    shared: false,
    requestLeadership({ onAcquired }) {
      onAcquired();
      return { release() {}, takeOver() {} };
    },
    post() {},
    onMessage() {
      return () => {};
    },
  };
}

const isAbort = (error: unknown) => (error as { name?: string })?.name === 'AbortError';

export function createTabCoordinator<S>(): TabCoordinator<S> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof BroadcastChannel === 'undefined') return soloCoordinator();

  const channel = new BroadcastChannel(CHANNEL_NAME);

  return {
    shared: true,

    requestLeadership({ onAcquired, onLost }) {
      let released = false;
      /** Identifies the latest request; an earlier one that's granted late just lets go. */
      let attempt = 0;
      let controller: AbortController | null = null;
      let releaseHeld: (() => void) | null = null;
      let stealing = false;

      const request = (steal: boolean) => {
        const id = ++attempt;
        const abort = steal ? null : new AbortController();
        controller = abort;
        stealing = steal;
        let held = false;

        // `steal` can't be combined with a signal.
        const options: LockOptions = abort ? { signal: abort.signal } : { steal: true };
        locks
          .request(LOCK_NAME, options, () => {
            stealing = false;
            // Released, or replaced by a takeover, after the grant was queued.
            if (released || id !== attempt) return undefined;
            held = true;
            return new Promise<void>(resolve => {
              releaseHeld = resolve;
              onAcquired();
            });
          })
          .catch((error: unknown) => {
            if (id === attempt) stealing = false;
            if (held && !released && id === attempt) {
              // Another tab stole the lock: this tab was suspended or unresponsive.
              releaseHeld = null;
              onLost();
              request(false);
              return;
            }
            if (!isAbort(error)) console.error('Error acquiring the monitor lock:', error);
          });
      };

      request(false);

      return {
        release() {
          released = true;
          if (releaseHeld) {
            releaseHeld();
            releaseHeld = null;
          } else {
            controller?.abort();
          }
        },
        takeOver() {
          if (released || releaseHeld || stealing) return;
          controller?.abort(); // leave the queue; the steal is granted right away
          request(true);
        },
      };
    },

    post(message) {
      channel.postMessage(message);
    },

    onMessage(listener) {
      const handler = (event: MessageEvent<TabMessage<S>>) => listener(event.data);
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
  };
}
