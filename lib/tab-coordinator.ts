/**
 * Elects one tab to run connectivity checks and lets tabs message each other.
 *
 * The leader holds a Web Lock for as long as it's monitoring. When its tab closes,
 * the browser releases the lock and the next waiting tab takes over. Tabs talk over
 * a BroadcastChannel. Where either API is missing (older browsers, plain-http LAN
 * addresses), every tab leads on its own, which is how the app worked before.
 */

export type TabMessage<S> =
  | { type: 'snapshot'; snapshot: S }
  | { type: 'hello' }
  | { type: 'clear' }
  | { type: 'checkNow' };

export interface TabCoordinator<S> {
  /** False when tabs can't coordinate and every tab leads. */
  readonly shared: boolean;
  /**
   * Calls `onAcquired` once this tab is the leader. Returns a function that gives up
   * leadership, or cancels the request if it hasn't been granted yet.
   */
  requestLeadership: (onAcquired: () => void) => () => void;
  post: (message: TabMessage<S>) => void;
  onMessage: (listener: (message: TabMessage<S>) => void) => () => void;
}

export const LOCK_NAME = 'isp-outage-tracker-monitor';
export const CHANNEL_NAME = 'isp-outage-tracker';

export function soloCoordinator<S>(): TabCoordinator<S> {
  return {
    shared: false,
    requestLeadership(onAcquired) {
      onAcquired();
      return () => {};
    },
    post() {},
    onMessage() {
      return () => {};
    },
  };
}

export function createTabCoordinator<S>(): TabCoordinator<S> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof BroadcastChannel === 'undefined') return soloCoordinator();

  const channel = new BroadcastChannel(CHANNEL_NAME);

  return {
    shared: true,

    requestLeadership(onAcquired) {
      const controller = new AbortController();
      let releaseHeld: (() => void) | null = null;
      let cancelled = false;

      locks
        .request(LOCK_NAME, { signal: controller.signal }, () => {
          // Released after the grant was queued but before this callback ran.
          if (cancelled) return undefined;
          return new Promise<void>(resolve => {
            releaseHeld = resolve;
            onAcquired();
          });
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name !== 'AbortError') {
            console.error('Error acquiring the monitor lock:', error);
          }
        });

      return () => {
        cancelled = true;
        if (releaseHeld) releaseHeld();
        else controller.abort();
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
