'use client';

import { ConnectionStatus } from '@/lib/monitor';
import { useNow } from '@/hooks/useNow';
import StatusIndicator from '@/components/StatusIndicator';

/*
 * The only parts of the dashboard that change every second. Each runs its own
 * ticker, so the rest of the page (stats, chart, history) doesn't re-render with them.
 */

interface CheckStatusLineProps {
  ispName: string | null;
  following: boolean;
  leaderUnresponsive: boolean;
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  checking: boolean;
  onCheckNow: () => void;
}

/** ISP, which tab is monitoring, the last check and a countdown to the next one. */
export function CheckStatusLine({
  ispName,
  following,
  leaderUnresponsive,
  lastCheckAt,
  nextCheckAt,
  checking,
  onCheckNow,
}: CheckStatusLineProps) {
  const now = useNow();
  const countdown = nextCheckAt !== null ? Math.max(0, Math.ceil((nextCheckAt - now) / 1000)) : null;

  return (
    <p className="text-sm text-gray-500">
      {ispName && <span>{ispName} • </span>}
      {leaderUnresponsive ? (
        <span>Monitoring tab isn’t responding, taking over… • </span>
      ) : (
        following && <span>Monitoring in another tab • </span>
      )}
      {lastCheckAt !== null && (
        <span>Last checked: {new Date(lastCheckAt).toLocaleTimeString()} • </span>
      )}
      {checking ? (
        <span>Checking now…</span>
      ) : (
        countdown !== null && (
          <>
            <span>Next check in {countdown}s</span>{' '}
            <button
              type="button"
              onClick={onCheckNow}
              className="font-medium text-blue-600 underline-offset-2 hover:underline"
            >
              Check now
            </button>
          </>
        )
      )}
    </p>
  );
}

interface LiveStatusIndicatorProps {
  status: ConnectionStatus;
  /** Start of the ongoing outage, if any. */
  outageStartTime: string | null;
}

/** The big status display, with how long the current outage has lasted. */
export function LiveStatusIndicator({ status, outageStartTime }: LiveStatusIndicatorProps) {
  // Only an ongoing outage needs a per-second clock.
  const now = useNow(outageStartTime ? 1000 : 60_000);
  const duration = outageStartTime ? Math.max(0, (now - Date.parse(outageStartTime)) / 1000) : null;
  return <StatusIndicator status={status} currentOutageDuration={duration} />;
}
