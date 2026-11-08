import { Outage } from '@/types';
import { checkConnectivity } from '@/lib/connectivity';
import { CHECK_INTERVAL_MS, FAILURE_THRESHOLD } from '@/lib/config';
import { storage } from '@/lib/storage';
import {
  ConnectionStatus,
  MonitorEvent,
  MonitorState,
  applyCheck,
  initialMonitorState,
  newOutageId,
  normalizeOutages,
} from '@/lib/monitor';

export interface MonitorSnapshot {
  /** False until state has been loaded from localStorage on the client. */
  loaded: boolean;
  status: ConnectionStatus;
  outages: Outage[];
  trackingStartTime: string | null;
  currentOutage: Outage | null;
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  checking: boolean;
}

export interface ConnectivityMonitor {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MonitorSnapshot;
  getServerSnapshot: () => MonitorSnapshot;
  /** Loads persisted state and starts checking. Returns a stop function. */
  start: () => () => void;
  clearHistory: () => void;
}

export interface MonitorDeps {
  check?: () => Promise<boolean>;
  now?: () => number;
  intervalMs?: number;
  threshold?: number;
  newId?: () => string;
}

const SERVER_SNAPSHOT: MonitorSnapshot = {
  loaded: false,
  status: 'unknown',
  outages: [],
  trackingStartTime: null,
  currentOutage: null,
  lastCheckAt: null,
  nextCheckAt: null,
  checking: false,
};

/**
 * Runs connectivity checks on a single self-rescheduling timer and persists
 * outages. Only one check runs at a time, and start/stop are safe to call
 * repeatedly, so React StrictMode's double-mounted effects can't cause
 * duplicate checks or duplicate outages.
 */
export function createConnectivityMonitor({
  check = checkConnectivity,
  now = Date.now,
  intervalMs = CHECK_INTERVAL_MS,
  threshold = FAILURE_THRESHOLD,
  newId = newOutageId,
}: MonitorDeps = {}): ConnectivityMonitor {
  const listeners = new Set<() => void>();
  let snapshot = SERVER_SNAPSHOT;

  let loaded = false;
  let running = false;
  let inFlight = false;
  /** Incremented when history is cleared, so a check already in flight is discarded. */
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextCheckAt: number | null = null;

  let state: MonitorState = initialMonitorState(null, null);
  let outages: Outage[] = [];
  let trackingStartTime: string | null = null;

  function emit() {
    snapshot = {
      loaded,
      status: state.status,
      outages,
      trackingStartTime,
      currentOutage: state.currentOutage,
      lastCheckAt: state.lastCheckAt,
      nextCheckAt,
      checking: inFlight,
    };
    listeners.forEach(listener => listener());
  }

  function load() {
    trackingStartTime = storage.getTrackingStartTime();
    if (!trackingStartTime) {
      trackingStartTime = new Date(now()).toISOString();
      storage.setTrackingStartTime(trackingStartTime);
    }

    const stored = storage.getOutages();
    outages = normalizeOutages(stored);
    if (outages.length !== stored.length) {
      storage.setOutages(outages);
    }

    const ongoing = outages.find(o => o.endTime === null) ?? null;
    state = initialMonitorState(ongoing, storage.getLastCheckAt());
    loaded = true;
  }

  function persist(events: MonitorEvent[]) {
    for (const event of events) {
      if (event.type === 'outageStarted') {
        storage.addOutage(event.outage);
      } else {
        const { endTime, duration } = event.outage;
        storage.updateOutage(event.outage.id, { endTime, duration });
      }
    }
    if (events.length > 0) {
      outages = storage.getOutages();
    }
  }

  function schedule(delayMs: number) {
    if (timer !== null) clearTimeout(timer);
    nextCheckAt = now() + delayMs;
    timer = setTimeout(runCheck, delayMs);
    emit();
  }

  async function runCheck() {
    timer = null;
    if (inFlight) return;

    inFlight = true;
    emit();

    const startedGeneration = generation;
    const at = now();
    let online: boolean | null = null;
    try {
      online = await check();
    } catch (error) {
      console.error('Error checking connectivity:', error);
    }

    inFlight = false;
    const stale = startedGeneration !== generation;

    if (online !== null && !stale) {
      try {
        const result = applyCheck(state, { online, at }, { threshold, intervalMs, newId });
        state = result.state;
        persist(result.events);
        storage.setLastCheckAt(at);
      } catch (error) {
        // e.g. localStorage quota exceeded; keep monitoring with in-memory state.
        console.error('Error recording connectivity check:', error);
      }
    }

    if (running) {
      // Re-check right away if history was cleared while this check was in flight.
      schedule(stale ? 0 : intervalMs);
    } else {
      emit();
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,

    start() {
      if (!loaded) load();
      if (!running) {
        running = true;
        if (!inFlight && timer === null) {
          schedule(0);
        } else {
          emit();
        }
      }
      return () => {
        running = false;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        nextCheckAt = null;
      };
    },

    clearHistory() {
      generation += 1;
      storage.clearOutages();
      trackingStartTime = new Date(now()).toISOString();
      storage.setTrackingStartTime(trackingStartTime);
      outages = [];
      state = initialMonitorState(null, null);

      if (running && !inFlight) {
        schedule(0);
      } else {
        emit();
      }
    },
  };
}
