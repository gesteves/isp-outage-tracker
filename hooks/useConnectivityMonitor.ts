'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { MonitorDeps, MonitorSnapshot, createConnectivityMonitor } from '@/lib/connectivity-monitor';

export interface UseConnectivityMonitor extends MonitorSnapshot {
  clearHistory: () => void;
  checkNow: () => void;
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
    const onNetworkChange = () => monitor.checkNow();
    // Background tabs have their timers throttled; catch up when the tab is shown again.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') monitor.checkIfOverdue();
    };

    window.addEventListener('online', onNetworkChange);
    window.addEventListener('offline', onNetworkChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('online', onNetworkChange);
      window.removeEventListener('offline', onNetworkChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [monitor]);

  return { ...snapshot, clearHistory: monitor.clearHistory, checkNow: monitor.checkNow };
}
