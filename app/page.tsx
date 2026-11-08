'use client';

import { useEffect, useState } from 'react';
import { calculateStats, exportToCSV } from '@/lib/utils';
import { detectISP } from '@/lib/isp-detection';
import { useConnectivityMonitor } from '@/hooks/useConnectivityMonitor';
import { useNow } from '@/hooks/useNow';
import StatusIndicator from '@/components/StatusIndicator';
import StatsDisplay from '@/components/StatsDisplay';
import OutageList from '@/components/OutageList';

export default function Dashboard() {
  const monitor = useConnectivityMonitor();
  const now = useNow();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [ispName, setIspName] = useState('');

  useEffect(() => {
    detectISP().then(name => {
      if (name) setIspName(name);
    });
  }, []);

  // Everything time-based is derived from `now` on each tick rather than kept in state.
  const stats = calculateStats(monitor.outages, monitor.trackingStartTime, now);
  const currentOutageDuration = monitor.currentOutage
    ? Math.max(0, (now - Date.parse(monitor.currentOutage.startTime)) / 1000)
    : null;
  const countdown = monitor.nextCheckAt !== null
    ? Math.max(0, Math.ceil((monitor.nextCheckAt - now) / 1000))
    : null;

  const handleExport = () => {
    exportToCSV(monitor.outages);
  };

  const confirmClearLogs = () => {
    monitor.clearHistory();
    setShowClearConfirm(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
            ISP Outage Tracker
          </h1>
          <p className="text-sm text-gray-500">
            {ispName && <span>{ispName} • </span>}
            {monitor.lastCheckAt !== null && (
              <span>Last checked: {new Date(monitor.lastCheckAt).toLocaleTimeString()} • </span>
            )}
            {monitor.checking ? (
              <span>Checking now…</span>
            ) : (
              countdown !== null && <span>Next check in {countdown}s</span>
            )}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-lg mb-8">
          <StatusIndicator
            status={monitor.status}
            currentOutageDuration={currentOutageDuration}
          />
        </div>

        <StatsDisplay stats={stats} />

        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <h2 className="text-xl md:text-2xl font-bold">Outage History</h2>
            <div className="flex gap-3 w-full md:w-auto">
              <button
                onClick={handleExport}
                disabled={monitor.outages.length === 0}
                className="flex-1 md:flex-none px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
              >
                Export CSV
              </button>
              <button
                onClick={() => setShowClearConfirm(true)}
                disabled={monitor.outages.length === 0}
                className="flex-1 md:flex-none px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
              >
                Clear Logs
              </button>
            </div>
          </div>

          <OutageList outages={monitor.outages} />
        </div>
      </div>

      {/* Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Clear All Logs?</h3>
            <p className="text-gray-600 mb-6">
              This will permanently delete all outage records and reset the tracking start time.
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmClearLogs}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
