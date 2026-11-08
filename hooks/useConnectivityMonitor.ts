'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { MonitorDeps, MonitorSnapshot, createConnectivityMonitor } from '@/lib/connectivity-monitor';

export interface UseConnectivityMonitor extends MonitorSnapshot {
  clearHistory: () => void;
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

  return { ...snapshot, clearHistory: monitor.clearHistory };
}
