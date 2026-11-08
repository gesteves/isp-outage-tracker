'use client';

import { DayStats, OutageStats } from '@/types';
import { formatDurationFromSeconds, formatPercentage } from '@/lib/format';
import { windowUptime } from '@/lib/stats';

interface StatsDisplayProps {
  stats: OutageStats;
  /** Daily breakdown, newest last, for uptime over recent windows. */
  days?: DayStats[];
}

/** Recent windows shown under the all-time uptime, in local days ending today. */
const WINDOWS: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
];

function localNote(count: number, seconds: number): string | null {
  if (count === 0) return null;
  return `+ ${count} local network ${count === 1 ? 'outage' : 'outages'} (${formatDurationFromSeconds(seconds)}), not counted`;
}

export default function StatsDisplay({ stats, days }: StatsDisplayProps) {
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
        {days && days.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {WINDOWS.map(range => {
              const uptime = windowUptime(days, range.days);
              return (
                <div key={range.label} className="flex gap-1">
                  <dt className="text-gray-400">{range.label}</dt>
                  <dd className="font-medium text-gray-700 tabular-nums">
                    {/* Nothing was monitored in that window, so there's nothing to say. */}
                    {uptime === null ? '—' : `${formatPercentage(uptime)}%`}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
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
