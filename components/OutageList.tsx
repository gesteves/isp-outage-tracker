'use client';

import { memo, useMemo, useState } from 'react';
import { Outage } from '@/types';
import { formatDurationFromSeconds, formatTimeAgo } from '@/lib/format';
import ConfirmDialog from '@/components/ConfirmDialog';

/** Outages shown at first, and added by each "Show more". */
export const PAGE_SIZE = 25;

interface OutageListProps {
  outages: Outage[];
  /** Current time, so relative times ("5 minutes ago") stay fresh without reading the clock during render. */
  now: number;
  /** Deletes an outage that has ended. Without it, there's no delete button. */
  onDelete?: (id: string) => void;
  /** Marks an outage that has ended as not a real outage, or counts it again. */
  onFlag?: (id: string, flagged: boolean) => void;
}

const actionClass = 'font-medium text-gray-500 hover:text-gray-800 hover:underline underline-offset-2';

function OutageList({ outages, now, onDelete, onFlag }: OutageListProps) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [pendingDelete, setPendingDelete] = useState<Outage | null>(null);

  // Most recent first. Only re-sorted when the outages change, not on every tick.
  const sorted = useMemo(
    () => [...outages].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime)),
    [outages],
  );

  if (outages.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No outages recorded yet.</p>
        <p className="text-sm mt-2">Keep this tab open to track outages.</p>
      </div>
    );
  }

  const shown = sorted.slice(0, visible);
  const remaining = sorted.length - shown.length;

  return (
    <>
      <div className="space-y-3">
        {shown.map(outage => (
          <div
            key={outage.id}
            className={`bg-white border border-gray-200 rounded-lg p-4 shadow-xs hover:shadow-md transition-shadow ${
              outage.flagged ? 'opacity-60' : ''
            }`}
          >
            {(outage.flagged || outage.cause === 'local' || outage.isp) && (
              <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                {outage.flagged && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                    Not counted
                  </span>
                )}
                {outage.cause === 'local' && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                    Local network
                  </span>
                )}
                {outage.isp && <span className="text-gray-500">{outage.isp}</span>}
              </div>
            )}
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
              <div className="flex-1">
                <div className="text-sm text-gray-500 mb-1">Started</div>
                <div className="font-medium text-base md:text-lg">
                  {new Date(outage.startTime).toLocaleString()}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {formatTimeAgo(outage.startTime, now)}
                </div>
              </div>

              <div className="flex-1">
                <div className="text-sm text-gray-500 mb-1">Ended</div>
                <div className="font-medium text-base md:text-lg">
                  {outage.endTime ? (
                    <>
                      {new Date(outage.endTime).toLocaleString()}
                      <div className="text-xs text-gray-400 mt-1">
                        {formatTimeAgo(outage.endTime, now)}
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

            {/* The ongoing outage can't be edited until it ends. */}
            {outage.endTime && (onFlag || onDelete) && (
              <div className="mt-3 flex gap-4 border-t border-gray-100 pt-3 text-sm">
                {onFlag && (
                  <button
                    type="button"
                    className={actionClass}
                    onClick={() => onFlag(outage.id, !outage.flagged)}
                  >
                    {outage.flagged ? 'Count as outage' : 'Not an outage'}
                  </button>
                )}
                {onDelete && (
                  <button type="button" className={actionClass} onClick={() => setPendingDelete(outage)}>
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setVisible(n => n + PAGE_SIZE)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Show {Math.min(PAGE_SIZE, remaining)} more ({remaining} older)
          </button>
        </div>
      )}

      {onDelete && (
        <ConfirmDialog
          open={pendingDelete !== null}
          title="Delete this outage?"
          confirmLabel="Delete"
          onConfirm={() => {
            if (pendingDelete) onDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        >
          {pendingDelete && (
            <>
              The outage that started {new Date(pendingDelete.startTime).toLocaleString()} will be
              removed from the history and the stats. To keep it on record but leave it out of the
              stats, choose “Not an outage” instead.
            </>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

// Memoized: the dashboard re-renders on every check, but the list only changes with the outages or the minute.
export default memo(OutageList);
