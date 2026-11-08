'use client';

import { useEffect, useState } from 'react';
import { CHECK_INTERVAL_MS } from '@/lib/config';
import { exportToCSV } from '@/lib/csv';
import {
  isAppleMobile,
  isStandalone,
  notificationsSupported,
  notifyOutageEnded,
  notifyOutageStarted,
  requestNotificationPermission,
} from '@/lib/notifications';
import { registerServiceWorker } from '@/lib/register-sw';
import { calculateStats, dailyBreakdown } from '@/lib/stats';
import { useConnectivityMonitor } from '@/hooks/useConnectivityMonitor';
import { useDocumentStatus } from '@/hooks/useDocumentStatus';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { useWakeLock } from '@/hooks/useWakeLock';
import ConfirmDialog from '@/components/ConfirmDialog';
import DailyChart from '@/components/DailyChart';
import OutageList from '@/components/OutageList';
import StatsDisplay from '@/components/StatsDisplay';
import StatusIndicator from '@/components/StatusIndicator';
import Toggle from '@/components/Toggle';

const monitorDeps = { onOutageStarted: notifyOutageStarted, onOutageEnded: notifyOutageEnded };

function NotificationToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [hint, setHint] = useState<string | null>(null);

  if (!notificationsSupported()) {
    // iPad and iPhone only allow web notifications from apps added to the home screen.
    return isAppleMobile() && !isStandalone() ? (
      <p className="text-xs text-gray-500">Add to Home Screen to get notified when the status changes.</p>
    ) : null;
  }

  const checked = enabled && Notification.permission === 'granted';

  const handleChange = async (on: boolean) => {
    if (!on) {
      onChange(false);
      setHint(null);
      return;
    }
    const permission = await requestNotificationPermission();
    onChange(permission === 'granted');
    setHint(permission === 'granted' ? null : 'Notifications are blocked in your browser settings.');
  };

  return (
    <Toggle
      label="Notify when status changes"
      checked={checked}
      onChange={on => void handleChange(on)}
      description={hint}
    />
  );
}

export default function Dashboard() {
  const [settings, updateSettings] = useSettings();
  const monitor = useConnectivityMonitor(monitorDeps);
  const now = useNow();
  const wakeLock = useWakeLock(settings.keepScreenOn);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useDocumentStatus(monitor.status);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Everything time-based is derived from `now` on each tick rather than kept in state.
  const stats = calculateStats(monitor, now, CHECK_INTERVAL_MS);
  const days = dailyBreakdown(monitor, now, CHECK_INTERVAL_MS, 30);
  const currentOutageDuration = monitor.currentOutage
    ? Math.max(0, (now - Date.parse(monitor.currentOutage.startTime)) / 1000)
    : null;
  const countdown = monitor.nextCheckAt !== null
    ? Math.max(0, Math.ceil((monitor.nextCheckAt - now) / 1000))
    : null;

  const confirmClearLogs = () => {
    monitor.clearHistory();
    setShowClearConfirm(false);
  };

  const handleKeepScreenOn = (on: boolean) => {
    // Tapping while it's on but refused (e.g. battery saver) asks again instead of turning it off.
    if (!on && wakeLock.error) {
      wakeLock.retry();
      return;
    }
    updateSettings({ keepScreenOn: on });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
            ISP Outage Tracker
          </h1>
          <p className="text-sm text-gray-500">
            {monitor.ispName && <span>{monitor.ispName} • </span>}
            {monitor.role === 'follower' && monitor.loaded && <span>Monitoring in another tab • </span>}
            {monitor.lastCheckAt !== null && (
              <span>Last checked: {new Date(monitor.lastCheckAt).toLocaleTimeString()} • </span>
            )}
            {monitor.checking ? (
              <span>Checking now…</span>
            ) : (
              countdown !== null && <span>Next check in {countdown}s</span>
            )}
          </p>

          {/* Rendered only on the client: support for these depends on the browser. */}
          {monitor.loaded && (
            <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-3">
              {wakeLock.supported && (
                <Toggle
                  label="Keep screen on"
                  checked={settings.keepScreenOn}
                  onChange={handleKeepScreenOn}
                  description={wakeLock.error ? `${wakeLock.error} Tap to retry.` : null}
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
        <StatusIndicator
          status={monitor.status}
          currentOutageDuration={currentOutageDuration}
        />
      </div>

      <StatsDisplay stats={stats} />

      {monitor.loaded && stats.trackingStartTime && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <DailyChart days={days} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h2 className="text-xl md:text-2xl font-bold">Outage History</h2>
          <div className="flex gap-3 w-full md:w-auto">
            <button
              onClick={() => exportToCSV(monitor.outages)}
              disabled={monitor.outages.length === 0}
              className="flex-1 md:flex-none px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
            >
              Export CSV
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              // Also resets uptime and monitored time, so it's useful even with no outages logged.
              disabled={!monitor.trackingStartTime}
              className="flex-1 md:flex-none px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
            >
              Clear Logs
            </button>
          </div>
        </div>

        <OutageList outages={monitor.outages} now={now} />
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
