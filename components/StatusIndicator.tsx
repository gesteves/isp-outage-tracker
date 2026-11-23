'use client';

import { ConnectionStatus } from '@/lib/monitor';
import { formatDurationFromSeconds } from '@/lib/format';

interface StatusIndicatorProps {
  status: ConnectionStatus;
  currentOutageDuration?: number | null;
}

const STYLES: Record<ConnectionStatus, { circle: string; text: string; icon: string; label: string }> = {
  up: {
    circle: 'bg-green-500 shadow-lg shadow-green-500/50',
    text: 'text-green-600 dark:text-green-400',
    icon: '✓',
    label: 'up',
  },
  down: {
    circle: 'bg-red-500 outage-pulse',
    text: 'text-red-600 dark:text-red-400',
    icon: '✗',
    label: 'down',
  },
  unknown: {
    circle: 'bg-gray-300 shadow-lg shadow-gray-300/50 dark:bg-gray-600 dark:shadow-gray-600/50 animate-pulse',
    text: 'text-gray-500 dark:text-gray-400',
    icon: '…',
    label: '',
  },
};

export default function StatusIndicator({ status, currentOutageDuration }: StatusIndicatorProps) {
  const style = STYLES[status];

  return (
    <div className="flex flex-col items-center justify-center p-8 md:p-12">
      <div className="relative mb-6">
        {status === 'down' && (
          <>
            <span aria-hidden="true" className="outage-ripple absolute inset-0 rounded-full bg-red-500" />
            <span aria-hidden="true" className="outage-ripple outage-ripple-delayed absolute inset-0 rounded-full bg-red-500" />
          </>
        )}
        <div
          className={`relative w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center transition-colors ${style.circle}`}
        >
          <span aria-hidden="true" className="text-4xl md:text-6xl">{style.icon}</span>
        </div>
      </div>

      <p role="status" aria-live="polite" className="relative text-3xl md:text-5xl font-bold mb-4 text-center">
        {status === 'unknown' ? (
          <span className={style.text}>Checking your connection…</span>
        ) : (
          <>
            Your internet is <span className={style.text}>{style.label}</span>
          </>
        )}
      </p>

      {status === 'down' && currentOutageDuration !== null && currentOutageDuration !== undefined && (
        <p className="relative text-xl md:text-2xl text-gray-600 dark:text-gray-400">
          It’s been down for {formatDurationFromSeconds(currentOutageDuration)}
        </p>
      )}
    </div>
  );
}
