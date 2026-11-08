'use client';

import { OutageStats } from '@/types';
import { formatDurationFromSeconds, formatPercentage } from '@/lib/utils';

interface StatsDisplayProps {
  stats: OutageStats;
}

export default function StatsDisplay({ stats }: StatsDisplayProps) {
  if (!stats.trackingStartTime) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="text-sm text-gray-500 mb-2">Uptime</div>
        <div className="text-3xl font-bold text-green-600">
          {formatPercentage(stats.uptimePercentage)}%
        </div>
        <div className="text-xs text-gray-400 mt-2">
          Since {new Date(stats.trackingStartTime).toLocaleDateString()}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="text-sm text-gray-500 mb-2">Total Outages</div>
        <div className="text-3xl font-bold text-gray-800">
          {stats.totalOutages}
        </div>
        <div className="text-xs text-gray-400 mt-2">
          {stats.totalOutages === 1 ? 'incident' : 'incidents'}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="text-sm text-gray-500 mb-2">Total Downtime</div>
        <div className="text-3xl font-bold text-red-600">
          {formatDurationFromSeconds(stats.totalDowntime)}
        </div>
        <div className="text-xs text-gray-400 mt-2">
          accumulated
        </div>
      </div>
    </div>
  );
}

