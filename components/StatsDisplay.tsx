'use client';

import { OutageStats } from '@/types';
import { formatDurationFromSeconds, formatPercentage } from '@/lib/format';

interface StatsDisplayProps {
  stats: OutageStats;
}

function localNote(count: number, seconds: number): string | null {
  if (count === 0) return null;
  return `+ ${count} local network ${count === 1 ? 'outage' : 'outages'} (${formatDurationFromSeconds(seconds)}), not counted`;
}

export default function StatsDisplay({ stats }: StatsDisplayProps) {
  if (!stats.trackingStartTime) {
    return null;
  }

  const note = localNote(stats.localOutages, stats.localDowntime);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="text-sm text-gray-500 mb-2">Uptime</div>
        <div className="text-3xl font-bold text-green-600">
          {formatPercentage(stats.uptimePercentage)}%
        </div>
        <div className="text-xs text-gray-400 mt-2">
          Monitored {formatDurationFromSeconds(stats.monitoredSeconds, { maxParts: 2 })} of{' '}
          {formatDurationFromSeconds(stats.trackedSeconds, { maxParts: 2 })} since{' '}
          {new Date(stats.trackingStartTime).toLocaleDateString()}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="text-sm text-gray-500 mb-2">Total Outages</div>
        <div className="text-3xl font-bold text-gray-800">
          {stats.ispOutages}
        </div>
        <div className="text-xs text-gray-400 mt-2">
          {stats.ispOutages === 1 ? 'incident' : 'incidents'}
          {note && <span className="block mt-1">{note}</span>}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="text-sm text-gray-500 mb-2">Total Downtime</div>
        <div className="text-3xl font-bold text-red-600">
          {formatDurationFromSeconds(stats.ispDowntime)}
        </div>
        <div className="text-xs text-gray-400 mt-2">
          accumulated
        </div>
      </div>
    </div>
  );
}
