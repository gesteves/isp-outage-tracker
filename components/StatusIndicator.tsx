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
    text: 'text-green-600',
    icon: '✓',
    label: 'up',
  },
  down: {
    circle: 'bg-red-500 shadow-lg shadow-red-500/50 animate-pulse',
    text: 'text-red-600',
    icon: '✗',
    label: 'down',
  },
  unknown: {
    circle: 'bg-gray-300 shadow-lg shadow-gray-300/50 animate-pulse',
    text: 'text-gray-500',
    icon: '…',
    label: '',
  },
};

export default function StatusIndicator({ status, currentOutageDuration }: StatusIndicatorProps) {
  const style = STYLES[status];

  return (
    <div className="flex flex-col items-center justify-center p-8 md:p-12">
      <div
        className={`w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center mb-6 transition-colors ${style.circle}`}
      >
        <span className="text-4xl md:text-6xl">{style.icon}</span>
      </div>

      <p role="status" aria-live="polite" className="text-3xl md:text-5xl font-bold mb-4 text-center">
        {status === 'unknown' ? (
          <span className={style.text}>Checking your connection…</span>
        ) : (
          <>
            Your internet is <span className={style.text}>{style.label}</span>
          </>
        )}
      </p>

      {status === 'down' && currentOutageDuration !== null && currentOutageDuration !== undefined && (
        <p className="text-xl md:text-2xl text-gray-600">
          It’s been down for {formatDurationFromSeconds(currentOutageDuration)}
        </p>
      )}
    </div>
  );
}
