'use client';

import { memo, useMemo, useState } from 'react';
import { Annotation, Outage } from '@/types';
import { formatDurationFromSeconds, formatTimeAgo } from '@/lib/format';
import ConfirmDialog from '@/components/ConfirmDialog';

/** Entries (outages and notes) shown at first, and added by each "Show more". */
export const PAGE_SIZE = 25;

function hasTags(outage: Outage): boolean {
  return Boolean(
    outage.flagged ||
      outage.cause === 'local' ||
      outage.failure === 'dns' ||
      outage.failure === 'mixed' ||
      outage.endReason === 'gap' ||
      outage.isp,
  );
}

/** "Comcast", or "Comcast → Backup LTE" when the connection came back on another ISP. */
function ispLabel(outage: Outage): string | null {
  if (!outage.isp) return null;
  if (outage.ispAfter && outage.ispAfter !== outage.isp) return `${outage.isp} → ${outage.ispAfter}`;
  return outage.isp;
}

type Entry =
  | { kind: 'outage'; at: number; outage: Outage }
  | { kind: 'note'; at: number; note: Annotation };

const noteTime = (time: string) =>
  new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface OutageListProps {
  outages: Outage[];
  /** Notes, shown among the outages at the time they were noted for. */
  annotations?: Annotation[];
  /** Current time, so relative times ("5 minutes ago") stay fresh without reading the clock during render. */
  now: number;
  /** Deletes an outage that has ended. Without it, there's no delete button. */
  onDelete?: (id: string) => void;
  /** Marks an outage that has ended as not a real outage, or counts it again. */
  onFlag?: (id: string, flagged: boolean) => void;
  /** Opens a note for editing. Without it, there's no edit button. */
  onEditNote?: (note: Annotation) => void;
  onDeleteNote?: (id: string) => void;
}

const actionClass = 'font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 hover:underline underline-offset-2';

const NO_NOTES: Annotation[] = [];

function NoteEntry({
  note,
  now,
  onEdit,
  onDelete,
}: {
  note: Annotation;
  now: number;
  onEdit?: (note: Annotation) => void;
  onDelete?: (note: Annotation) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="rounded-full bg-gray-700 px-2 py-0.5 font-medium text-white dark:bg-gray-300 dark:text-gray-900">
          Note
        </span>
        <time dateTime={note.time} className="font-medium text-gray-700 dark:text-gray-300">
          {noteTime(note.time)}
        </time>
        <span className="text-gray-400 dark:text-gray-500">{formatTimeAgo(note.time, now)}</span>
        {(onEdit || onDelete) && (
          <span className="ml-auto flex gap-4 text-sm">
            {onEdit && (
              <button type="button" className={actionClass} onClick={() => onEdit(note)}>
                Edit
              </button>
            )}
            {onDelete && (
              <button type="button" className={actionClass} onClick={() => onDelete(note)}>
                Delete
              </button>
            )}
          </span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">{note.text}</p>
    </div>
  );
}

function OutageList({
  outages,
  annotations = NO_NOTES,
  now,
  onDelete,
  onFlag,
  onEditNote,
  onDeleteNote,
}: OutageListProps) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [pendingDelete, setPendingDelete] = useState<Outage | null>(null);
  const [pendingNoteDelete, setPendingNoteDelete] = useState<Annotation | null>(null);

  // Most recent first. Only re-sorted when the history changes, not on every tick. A
  // note at the same time as an outage's start goes above it: it's usually the cause.
  const sorted = useMemo(() => {
    const entries: Entry[] = [
      ...outages.map(outage => ({ kind: 'outage' as const, at: Date.parse(outage.startTime), outage })),
      ...annotations.map(note => ({ kind: 'note' as const, at: Date.parse(note.time), note })),
    ];
    return entries.sort((a, b) => b.at - a.at || (a.kind === 'note' ? -1 : 0) - (b.kind === 'note' ? -1 : 0));
  }, [outages, annotations]);

  if (sorted.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
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
        {shown.map(entry => {
          if (entry.kind === 'note') {
            return (
              <NoteEntry
                key={entry.note.id}
                note={entry.note}
                now={now}
                onEdit={onEditNote}
                onDelete={onDeleteNote ? setPendingNoteDelete : undefined}
              />
            );
          }
          const { outage } = entry;
          return (
            <div
              key={outage.id}
              className={`bg-white border border-gray-200 rounded-lg p-4 shadow-xs hover:shadow-md dark:bg-gray-900 dark:border-gray-800 dark:shadow-none dark:hover:shadow-none dark:hover:border-gray-700 transition-shadow ${
                outage.flagged ? 'opacity-60' : ''
              }`}
            >
              {hasTags(outage) && (
                <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                  {outage.flagged && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
                      Not counted
                    </span>
                  )}
                  {outage.cause === 'local' && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      Local network
                    </span>
                  )}
                  {(outage.failure === 'dns' || outage.failure === 'mixed') && (
                    <span
                      className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-800 dark:bg-purple-400/15 dark:text-purple-300"
                      title="Sites couldn't be reached by name, but IP addresses still answered."
                    >
                      {outage.failure === 'dns' ? 'DNS only' : 'Partly DNS'}
                    </span>
                  )}
                  {outage.endReason === 'gap' && (
                    <span
                      className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      title="The app stopped checking during this outage, so it may have lasted longer."
                    >
                      Monitoring stopped
                    </span>
                  )}
                  {outage.isp && <span className="text-gray-500 dark:text-gray-400">{ispLabel(outage)}</span>}
                </div>
              )}
              <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
                <div className="flex-1">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Started</div>
                  <div className="font-medium text-base md:text-lg">
                    {new Date(outage.startTime).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {formatTimeAgo(outage.startTime, now)}
                  </div>
                </div>

                <div className="flex-1">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Ended</div>
                  <div className="font-medium text-base md:text-lg">
                    {outage.endTime ? (
                      <>
                        {new Date(outage.endTime).toLocaleString()}
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {formatTimeAgo(outage.endTime, now)}
                        </div>
                      </>
                    ) : (
                      <span className="text-red-500 dark:text-red-400">Ongoing</span>
                    )}
                  </div>
                </div>

                <div className="flex-1">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Duration</div>
                  <div className="font-medium text-base md:text-lg">
                    {outage.duration !== null ? (
                      formatDurationFromSeconds(outage.duration)
                    ) : (
                      <span className="text-red-500 dark:text-red-400">In progress</span>
                    )}
                  </div>
                </div>
              </div>

              {/* The ongoing outage can't be edited until it ends. */}
              {outage.endTime && (onFlag || onDelete) && (
                <div className="mt-3 flex gap-4 border-t border-gray-100 dark:border-gray-800 pt-3 text-sm">
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
          );
        })}
      </div>

      {remaining > 0 && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setVisible(n => n + PAGE_SIZE)}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
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

      {onDeleteNote && (
        <ConfirmDialog
          open={pendingNoteDelete !== null}
          title="Delete this note?"
          confirmLabel="Delete"
          onConfirm={() => {
            if (pendingNoteDelete) onDeleteNote(pendingNoteDelete.id);
            setPendingNoteDelete(null);
          }}
          onCancel={() => setPendingNoteDelete(null)}
        >
          {pendingNoteDelete && <>The note “{pendingNoteDelete.text}” will be removed from the history.</>}
        </ConfirmDialog>
      )}
    </>
  );
}

// Memoized: the dashboard re-renders on every check, but the list only changes with the history or the minute.
export default memo(OutageList);
