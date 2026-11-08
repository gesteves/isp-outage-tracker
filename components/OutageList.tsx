'use client';

import { Outage } from '@/types';
import { formatTimeAgo, formatDurationFromSeconds } from '@/lib/utils';

interface OutageListProps {
  outages: Outage[];
}

export default function OutageList({ outages }: OutageListProps) {
  if (outages.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No outages recorded yet.</p>
        <p className="text-sm mt-2">Keep this tab open to track outages.</p>
      </div>
    );
  }

  // Show most recent first
  const sortedOutages = [...outages].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );

  return (
    <div className="space-y-3">
      {sortedOutages.map((outage) => (
        <div
          key={outage.id}
          className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs hover:shadow-md transition-shadow"
        >
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
            <div className="flex-1">
              <div className="text-sm text-gray-500 mb-1">Started</div>
              <div className="font-medium text-base md:text-lg">
                {new Date(outage.startTime).toLocaleString()}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {formatTimeAgo(outage.startTime)}
              </div>
            </div>
            
            <div className="flex-1">
              <div className="text-sm text-gray-500 mb-1">Ended</div>
              <div className="font-medium text-base md:text-lg">
                {outage.endTime ? (
                  <>
                    {new Date(outage.endTime).toLocaleString()}
                    <div className="text-xs text-gray-400 mt-1">
                      {formatTimeAgo(outage.endTime)}
                    </div>
                  </>
                ) : (
                  <span className="text-red-500">Ongoing</span>
                )}
              </div>
            </div>
            
            <div className="flex-1">
              <div className="text-sm text-gray-500 mb-1">Duration</div>
              <div className="font-medium text-base md:text-lg">
                {outage.duration !== null ? (
                  formatDurationFromSeconds(outage.duration)
                ) : (
                  <span className="text-red-500">In progress</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

