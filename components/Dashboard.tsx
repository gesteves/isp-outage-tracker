'use client';

import { useEffect, useMemo, useState } from 'react';
import { CHECK_INTERVAL_MS, FAILURE_THRESHOLD } from '@/lib/config';
import { exportToCSV } from '@/lib/csv';
import { registerServiceWorker } from '@/lib/register-sw';
import { exportReport } from '@/lib/report-export';
import { calculateStats, dailyBreakdown } from '@/lib/stats';
import { useConnectivityMonitor } from '@/hooks/useConnectivityMonitor';
import { useDocumentStatus } from '@/hooks/useDocumentStatus';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { useWakeLock } from '@/hooks/useWakeLock';
import { Annotation } from '@/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import DailyChart from '@/components/DailyChart';
import ExportMenu from '@/components/ExportMenu';
import { CheckStatusLine, LiveStatusIndicator } from '@/components/LiveStatus';
import NoteDialog from '@/components/NoteDialog';
import OutageList from '@/components/OutageList';
import StatsDisplay from '@/components/StatsDisplay';
import Toggle from '@/components/Toggle';

/** Holds the stats cards' space until stored history has loaded. */
function StatsPlaceholder() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-32 bg-white rounded-xl shadow-lg dark:bg-gray-900 dark:shadow-none dark:ring-1 dark:ring-white/10" />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [settings, updateSettings] = useSettings();
  const monitor = useConnectivityMonitor();
  // Stats, the chart and the history only need to move once a minute. The parts that
  // tick every second (countdown, outage duration) have their own clock in LiveStatus.
  const minuteNow = useNow(60_000);
  const wakeLock = useWakeLock(settings.keepScreenOn);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  /** The note being edited, or the time a new one starts at. Null while the dialog is closed. */
  const [editingNote, setEditingNote] = useState<Annotation | { newAt: number } | null>(null);

  useDocumentStatus(monitor.status);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  const { loaded, outages, annotations, trackingStartTime, lastCheckAt, monitoredByDay, legacyMonitoredMs } = monitor;
  // Never behind the last check, so monitored time can't run ahead of tracked time.
  const now = Math.max(minuteNow, lastCheckAt ?? 0);
  const { stats, days } = useMemo(() => {
    const input = { outages, trackingStartTime, lastCheckAt, monitoredByDay, legacyMonitoredMs };
    return {
      stats: calculateStats(input, now, CHECK_INTERVAL_MS),
      days: dailyBreakdown(input, now, CHECK_INTERVAL_MS, 30),
    };
  }, [outages, trackingStartTime, lastCheckAt, monitoredByDay, legacyMonitoredMs, now]);

  const confirmClearLogs = () => {
    monitor.clearHistory();
    setShowClearConfirm(false);
  };

  const wakeLockError = wakeLock.error ? (
    <>
      {wakeLock.error}{' '}
      <button
        type="button"
        onClick={wakeLock.retry}
        className="font-medium text-blue-600 dark:text-blue-400 underline-offset-2 hover:underline"
      >
        Retry
      </button>
    </>
  ) : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-gray-100 mb-2">
            ISP Outage Tracker
          </h1>
          <CheckStatusLine
            ispName={monitor.ispName}
            following={monitor.following}
            leaderUnresponsive={monitor.leaderUnresponsive}
            lastCheckAt={lastCheckAt}
            nextCheckAt={monitor.nextCheckAt}
            checking={monitor.checking}
            onCheckNow={monitor.checkNow}
          />

          {/* Rendered only on the client: support for this depends on the browser. */}
          {loaded && (
            <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-3">
              {wakeLock.supported && (
                <Toggle
                  label="Keep screen on"
                  checked={settings.keepScreenOn}
                  onChange={on => updateSettings({ keepScreenOn: on })}
                  description={wakeLockError}
                />
              )}
            </div>
          )}
        </div>
      </header>

      <div className="bg-white rounded-xl shadow-lg dark:bg-gray-900 dark:shadow-none dark:ring-1 dark:ring-white/10 mb-8">
        <LiveStatusIndicator
          status={monitor.status}
          outageStartTime={monitor.currentOutage?.startTime ?? null}
        />
      </div>

      {/* The static HTML is rendered with no history, so hold the space until it loads. */}
      {loaded ? <StatsDisplay stats={stats} days={days} /> : <StatsPlaceholder />}

      {loaded && stats.trackingStartTime && (
        <div className="bg-white rounded-xl shadow-lg dark:bg-gray-900 dark:shadow-none dark:ring-1 dark:ring-white/10 p-6 mb-8">
          <DailyChart days={days} annotations={annotations} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg dark:bg-gray-900 dark:shadow-none dark:ring-1 dark:ring-white/10 p-6 mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h2 className="text-xl md:text-2xl font-bold">Outage History</h2>
          <div className="flex gap-3 w-full md:w-auto">
            <button
              onClick={() => setEditingNote({ newAt: Date.now() })}
              disabled={!loaded}
              className="flex-1 md:flex-none whitespace-nowrap px-2 md:px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
            >
              Add Note
            </button>
            <ExportMenu
              className="flex-1 md:flex-none"
              disabled={outages.length === 0 && annotations.length === 0}
              options={[
                {
                  id: 'csv',
                  label: 'CSV',
                  description: 'For spreadsheets',
                  onSelect: () => exportToCSV(outages, annotations),
                },
                {
                  id: 'markdown',
                  label: 'Markdown',
                  description: 'Data plus definitions, to paste into a chat',
                  onSelect: () => {
                    // Exported as of this moment, not the last minute tick the stats use.
                    const at = Math.max(Date.now(), lastCheckAt ?? 0);
                    exportReport(
                      { outages, annotations, trackingStartTime, lastCheckAt, monitoredByDay, legacyMonitoredMs },
                      { now: at, intervalMs: CHECK_INTERVAL_MS, failureThreshold: FAILURE_THRESHOLD, ispName: monitor.ispName },
                    );
                  },
                },
              ]}
            />
            <button
              onClick={() => setShowClearConfirm(true)}
              // Also resets uptime and monitored time, so it's useful even with no outages logged.
              disabled={!trackingStartTime}
              className="flex-1 md:flex-none whitespace-nowrap px-2 md:px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 dark:disabled:text-gray-400 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
            >
              Clear Logs
            </button>
          </div>
        </div>

        {loaded ? (
          <OutageList
            outages={outages}
            annotations={annotations}
            now={now}
            onDelete={monitor.deleteOutage}
            onFlag={monitor.setOutageFlagged}
            onEditNote={setEditingNote}
            onDeleteNote={monitor.deleteAnnotation}
          />
        ) : (
          <p className="text-center py-12 text-gray-400 dark:text-gray-500">Loading history…</p>
        )}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear All Logs?"
        confirmLabel="Clear All"
        onConfirm={confirmClearLogs}
        onCancel={() => setShowClearConfirm(false)}
      >
        This will permanently delete all outage records and notes and start tracking over
        from now, resetting uptime and monitored time. This action cannot be undone.
      </ConfirmDialog>

      {editingNote && (
        <NoteDialog
          title={'newAt' in editingNote ? 'Add Note' : 'Edit Note'}
          initialTime={'newAt' in editingNote ? editingNote.newAt : Date.parse(editingNote.time)}
          initialText={'newAt' in editingNote ? '' : editingNote.text}
          onSave={input => {
            const saved =
              'newAt' in editingNote
                ? monitor.addAnnotation(input) !== null
                : monitor.updateAnnotation(editingNote.id, input);
            if (saved) setEditingNote(null);
            return saved;
          }}
          onCancel={() => setEditingNote(null)}
        />
      )}
    </div>
  );
}
