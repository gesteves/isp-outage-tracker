'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  MonitorDeps,
  MonitorSnapshot,
  RECONNECT_SETTLE_MS,
  createConnectivityMonitor,
} from '@/lib/connectivity-monitor';

export interface UseConnectivityMonitor extends MonitorSnapshot {
  clearHistory: () => void;
  checkNow: () => void;
  deleteOutage: (id: string) => void;
  setOutageFlagged: (id: string, flagged: boolean) => void;
}

export function useConnectivityMonitor(deps?: MonitorDeps): UseConnectivityMonitor {
  // Deps are read once; the monitor lives for the lifetime of the component.
  const [monitor] = useState(() => createConnectivityMonitor(deps));
  const snapshot = useSyncExternalStore(
    monitor.subscribe,
    monitor.getSnapshot,
    monitor.getServerSnapshot,
  );

  useEffect(() => monitor.start(), [monitor]);

  useEffect(() => {
    // The browser noticed the device's network change: re-check instead of waiting.
    // Going offline is checked right away (it'll fail, and be tagged local); coming
    // back gets a moment to settle, so a request sent mid-reconnect doesn't fail.
    const onOffline = () => monitor.checkNow();
    const onOnline = () => monitor.checkSoon(RECONNECT_SETTLE_MS);
    // Background tabs have their timers throttled; catch up when the tab is shown again.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') monitor.checkIfOverdue();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [monitor]);

  return {
    ...snapshot,
    clearHistory: monitor.clearHistory,
    checkNow: monitor.checkNow,
    deleteOutage: monitor.deleteOutage,
    setOutageFlagged: monitor.setOutageFlagged,
  };
}
