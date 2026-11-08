'use client';

import { useEffect, useMemo, useState } from 'react';
import { CHECK_INTERVAL_MS } from '@/lib/config';
import { exportToCSV } from '@/lib/csv';
import { notifyOutageEnded, notifyOutageStarted } from '@/lib/notifications';
import { registerServiceWorker } from '@/lib/register-sw';
import { calculateStats, dailyBreakdown } from '@/lib/stats';
import { useConnectivityMonitor } from '@/hooks/useConnectivityMonitor';
import { useDocumentStatus } from '@/hooks/useDocumentStatus';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { useWakeLock } from '@/hooks/useWakeLock';
import ConfirmDialog from '@/components/ConfirmDialog';
import DailyChart from '@/components/DailyChart';
import { CheckStatusLine, LiveStatusIndicator } from '@/components/LiveStatus';
import NotificationToggle from '@/components/NotificationToggle';
import OutageList from '@/components/OutageList';
import StatsDisplay from '@/components/StatsDisplay';
import Toggle from '@/components/Toggle';

const monitorDeps = { onOutageStarted: notifyOutageStarted, onOutageEnded: notifyOutageEnded };

/** Holds the stats cards' space until stored history has loaded. */
function StatsPlaceholder() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-32 bg-white rounded-xl shadow-lg" />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [settings, updateSettings] = useSettings();
  const monitor = useConnectivityMonitor(monitorDeps);
  // Stats, the chart and the history only need to move once a minute. The parts that
  // tick every second (countdown, outage duration) have their own clock in LiveStatus.
  const minuteNow = useNow(60_000);
  const wakeLock = useWakeLock(settings.keepScreenOn);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useDocumentStatus(monitor.status);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  const { loaded, outages, trackingStartTime, lastCheckAt, monitoredByDay, legacyMonitoredMs } = monitor;
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
        className="font-medium text-blue-600 underline-offset-2 hover:underline"
      >
        Retry
      </button>
    </>
  ) : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
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

          {/* Rendered only on the client: support for these depends on the browser. */}
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
              <NotificationToggle
                enabled={settings.notifyOnStatusChange}
                onChange={on => updateSettings({ notifyOnStatusChange: on })}
              />
            </div>
          )}
        </div>
      </header>

      <div className="bg-white rounded-xl shadow-lg mb-8">
        <LiveStatusIndicator
          status={monitor.status}
          outageStartTime={monitor.currentOutage?.startTime ?? null}
        />
      </div>

      {/* The static HTML is rendered with no history, so hold the space until it loads. */}
      {loaded ? <StatsDisplay stats={stats} days={days} /> : <StatsPlaceholder />}

      {loaded && stats.trackingStartTime && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <DailyChart days={days} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h2 className="text-xl md:text-2xl font-bold">Outage History</h2>
          <div className="flex gap-3 w-full md:w-auto">
            <button
              onClick={() => exportToCSV(outages)}
              disabled={outages.length === 0}
              className="flex-1 md:flex-none px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
            >
              Export CSV
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              // Also resets uptime and monitored time, so it's useful even with no outages logged.
              disabled={!trackingStartTime}
              className="flex-1 md:flex-none px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
            >
              Clear Logs
            </button>
          </div>
        </div>

        {loaded ? (
          <OutageList
            outages={outages}
            now={now}
            onDelete={monitor.deleteOutage}
            onFlag={monitor.setOutageFlagged}
          />
        ) : (
          <p className="text-center py-12 text-gray-400">Loading history…</p>
        )}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear All Logs?"
        confirmLabel="Clear All"
        onConfirm={confirmClearLogs}
        onCancel={() => setShowClearConfirm(false)}
      >
        This will permanently delete all outage records and start tracking over from now,
        resetting uptime and monitored time. This action cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
